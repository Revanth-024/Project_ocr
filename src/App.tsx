/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Sun,
  Moon,
  FileText, 
  Upload, 
  Search, 
  Plus, 
  ChevronLeft, 
  Edit3, 
  Save, 
  Trash2, 
  Languages, 
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Maximize2,
  Download,
  Shield,
  LogOut,
  X,
  Filter,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { DocumentRecord, ViewState, User } from './types';
import { performOCR, translateText } from './services/geminiService';
import { LogIn } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [view, setView] = useState<ViewState>('list');
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportLanguage, setExportLanguage] = useState('English');
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') === 'dark' || 
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });
  const [filterLanguage, setFilterLanguage] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [exportContent, setExportContent] = useState({ text: '', summary: '', targetLang: '' });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfContentRef = useRef<HTMLDivElement>(null);
  const pdfExportRef = useRef<HTMLDivElement>(null);

  // Dark Mode Effect
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const isAdmin = user?.role === 'admin';

  // Auth Effect
  useEffect(() => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user));
    } else {
      localStorage.removeItem('user');
    }
  }, [user]);

  // Data Fetching
  useEffect(() => {
    if (!user) return;

    const fetchDocs = async () => {
      try {
        const res = await fetch('/api/documents', {
          headers: { 'Authorization': `Bearer ${user.token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setDocuments(data.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        }
      } catch (e) {
        console.error("Fetch failed", e);
      }
    };

    fetchDocs();
    const interval = setInterval(fetchDocs, 5000); // Simple polling for real-time feel
    return () => clearInterval(interval);
  }, [user, view]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    try {
      const endpoint = isRegistering ? '/api/register' : '/api/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok) {
        setUser({ ...data.user, token: data.token });
      } else {
        setUploadError(data.error || "Authentication failed");
      }
    } catch (e) {
      setUploadError("Server connection failed");
    }
  };

  const handleLogout = () => {
    setUser(null);
    setView('list');
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    // Firestore document limit is 1MB. Base64 is ~33% larger than binary.
    // We limit to ~700KB to be safe.
    if (file.size > 700 * 1024) {
      setUploadError("File is too large. Please upload an image smaller than 700KB.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        
        try {
          const ocrResult = await performOCR(base64, file.type);
          
          const docId = crypto.randomUUID();
          const newDoc: DocumentRecord = {
            id: docId,
            title: file.name.replace(/\.[^/.]+$/, ""),
            subjectName: ocrResult.subjectName,
            date: new Date().toISOString(),
            imageUrl: base64,
            extractedText: ocrResult.text,
            language: ocrResult.language,
            summary: ocrResult.summary,
            status: 'processed',
            uid: user.id
          };

          const res = await fetch('/api/documents', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${user.token}`
            },
            body: JSON.stringify(newDoc)
          });

          if (res.ok) {
            setDocuments(prev => [newDoc, ...prev]);
            setView('list');
          } else {
            setUploadError("Failed to save document");
          }
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : "Failed to process image");
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setUploadError("Failed to read file");
      setIsUploading(false);
    }
  };

  const handleTranslate = async (targetLang: string) => {
    if (!selectedDoc) return;
    
    setIsTranslating(true);
    try {
      const translated = await translateText(selectedDoc.extractedText, targetLang);
      if (translated) {
        await updateDocumentText(selectedDoc.id, translated);
        // Update local state immediately for better UX
        setSelectedDoc(prev => prev ? { ...prev, extractedText: translated } : null);
      } else {
        setUploadError("Translation returned empty text.");
      }
    } catch (err) {
      setUploadError("Translation failed. Please try again.");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleExportPDF = async (targetLang: string = 'Original') => {
    if (!selectedDoc || !pdfExportRef.current) return;

    setIsExporting(true);
    try {
      let textToExport = selectedDoc.extractedText;
      let summaryToExport = selectedDoc.summary;

      if (targetLang !== 'Original') {
        textToExport = await translateText(selectedDoc.extractedText, targetLang);
        summaryToExport = await translateText(selectedDoc.summary, targetLang);
      }

      // Update export content state for the hidden template
      setExportContent({
        text: textToExport,
        summary: summaryToExport,
        targetLang: targetLang
      });

      // Wait for React to render the hidden template
      await new Promise(resolve => setTimeout(resolve, 500));

      const canvas = await html2canvas(pdfExportRef.current, {
        scale: 2, // Higher quality
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      pdf.save(`${selectedDoc.title}_${targetLang}.pdf`);
      setShowExportModal(false);
    } catch (err) {
      console.error("PDF Export Error:", err);
      setUploadError("Failed to export PDF. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const deleteDocument = async (id: string) => {
    if (!user) return;
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${user.token}` }
      });
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== id));
        setSelectedDoc(null);
        setView('list');
      }
    } catch (e) {
      setUploadError("Failed to delete document");
    }
  };

  const updateDocumentText = async (id: string, newText: string) => {
    if (!user) return;
    setSelectedDoc(prev => prev && prev.id === id ? { ...prev, extractedText: newText } : prev);
    
    setIsSaving(true);
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({ extractedText: newText })
      });
      if (!res.ok) throw new Error();
    } catch (e) {
      setUploadError("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const filteredDocs = documents.filter(doc => {
    const matchesSearch = 
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.extractedText.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.language.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.subjectName.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesLanguage = filterLanguage === 'All' || doc.language === filterLanguage;
    const matchesStatus = filterStatus === 'All' || doc.status === filterStatus;
    
    return matchesSearch && matchesLanguage && matchesStatus;
  });

  const stats = {
    total: documents.length,
    english: documents.filter(d => d.language === 'English').length,
    telugu: documents.filter(d => d.language === 'Telugu').length,
    hindi: documents.filter(d => d.language === 'Hindi').length,
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F2]">
        <Loader2 className="animate-spin opacity-20" size={40} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-brand-bg overflow-hidden">
        <main className="flex-1 flex flex-col items-center justify-center p-8 relative">
          <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-[0.03]">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-brand-accent blur-[120px]" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-brand-accent blur-[120px]" />
          </div>

          <motion.div 
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="text-center relative z-10 px-4 w-full max-w-md"
          >
            <div className="micro-label mb-6 sm:mb-8">Official Document Digitization System</div>
            <h1 className="font-serif italic text-5xl sm:text-7xl tracking-tighter leading-[0.85] mb-8">
              Doc<br />
              <span className="text-brand-accent/20">Digitizer</span>
            </h1>
            
            <form onSubmit={handleLogin} className="space-y-4 bg-brand-bg p-8 rounded-3xl border border-brand-border shadow-2xl">
              <div className="space-y-2 text-left">
                <label className="micro-label ml-1">Email Address</label>
                <input 
                  type="email" 
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-brand-bg border border-brand-border focus:border-brand-accent/30 outline-none transition-all text-sm"
                  placeholder="name@department.gov"
                />
              </div>
              <div className="space-y-2 text-left">
                <label className="micro-label ml-1">Access Password</label>
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-brand-bg border border-brand-border focus:border-brand-accent/30 outline-none transition-all text-sm"
                  placeholder="••••••••"
                />
              </div>

              {uploadError && (
                <div className="flex items-center gap-2 text-red-600 text-[10px] font-bold uppercase tracking-wider bg-red-50 p-3 rounded-xl border border-red-100">
                  <AlertCircle size={14} />
                  <span>{uploadError}</span>
                </div>
              )}

              <button 
                type="submit"
                className="btn-primary w-full py-4 text-sm justify-center mt-4"
              >
                <LogIn size={18} strokeWidth={2.5} />
                {isRegistering ? 'Create Account' : 'Secure Login'}
              </button>

              <button 
                type="button"
                onClick={() => setIsRegistering(!isRegistering)}
                className="text-[10px] font-bold uppercase tracking-widest text-brand-muted hover:text-brand-accent transition-colors mt-4"
              >
                {isRegistering ? 'Already have an account? Login' : 'Need an account? Register'}
              </button>
            </form>

            <div className="flex items-center justify-center gap-4 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] text-brand-muted mt-8">
              <Shield size={12} />
              Authorized Personnel Only
            </div>
          </motion.div>

          <div className="absolute bottom-8 sm:bottom-12 left-8 sm:left-12 micro-label">v2.5.0</div>
          <div className="absolute bottom-8 sm:bottom-12 right-8 sm:right-12 micro-label hidden sm:block">Department of Records</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-brand-bg">
      {/* Navigation Header */}
      <header className="h-20 border-b border-brand-border bg-brand-bg/80 backdrop-blur-2xl sticky top-0 z-50 px-6 sm:px-12 flex items-center justify-between">
        <div className="flex items-center gap-4 sm:gap-8 cursor-pointer group" onClick={() => setView('list')}>
          <div className="flex flex-col">
            <h1 className="font-serif italic text-xl sm:text-2xl tracking-tight leading-none">Doc Digitizer</h1>
            <div className="micro-label mt-1.5 hidden sm:block">Police Records Management</div>
          </div>
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          <div className="relative hidden xl:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" size={14} />
            <input 
              type="text" 
              placeholder="SEARCH ARCHIVE..." 
              className="pl-10 pr-4 py-2 bg-brand-bg/50 rounded-full text-[10px] font-bold uppercase tracking-widest w-64 focus:outline-none transition-all border border-transparent focus:border-brand-accent/10 focus:bg-brand-bg"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            {isAdmin && (
              <button 
                onClick={() => setView(view === 'admin' ? 'list' : 'admin')}
                className={cn(
                  "h-10 px-5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 border",
                  view === 'admin' ? "bg-brand-accent text-brand-bg border-brand-accent" : "bg-brand-bg text-brand-muted border-brand-border hover:border-brand-accent/20"
                )}
              >
                <Shield size={14} />
                <span className="hidden md:inline">{view === 'admin' ? 'Admin Mode' : 'Admin Panel'}</span>
              </button>
            )}

            <button 
              onClick={() => fileInputRef.current?.click()}
              className="h-10 px-5 bg-brand-accent text-brand-bg rounded-full text-[10px] font-bold uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95 flex items-center gap-2 shadow-lg shadow-brand-accent/10"
            >
              <Plus size={14} strokeWidth={3} className="text-brand-bg" />
              <span className="hidden md:inline text-brand-bg">New Scan</span>
              <span className="md:hidden text-brand-bg">New</span>
            </button>
            
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="h-10 w-10 flex items-center justify-center rounded-full border border-brand-border bg-brand-bg text-brand-muted hover:border-brand-accent/20 transition-all"
              title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <div className="h-6 w-px bg-brand-border mx-1" />

            <button 
              onClick={handleLogout}
              className="h-10 px-4 flex items-center gap-3 text-brand-muted hover:text-brand-ink transition-colors rounded-full hover:bg-brand-bg"
              title="Logout"
            >
              <span className="micro-label hidden lg:block">Sign Out</span>
              <div className="w-8 h-8 flex items-center justify-center bg-brand-bg rounded-full group-hover:bg-brand-ink group-hover:text-brand-bg transition-all">
                <LogOut size={14} />
              </div>
            </button>

            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={handleFileUpload}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        {/* Hidden PDF Export Template */}
        <div className="fixed -left-[9999px] top-0 pointer-events-none">
          <div 
            ref={pdfExportRef} 
            className="w-[800px] bg-white p-16 text-black"
            style={{ fontFamily: 'sans-serif', backgroundColor: '#ffffff', color: '#000000' }}
          >
            <div className="flex items-center justify-between mb-16 pb-8" style={{ borderBottom: '3px solid #000000' }}>
              <div>
                <h1 className="text-5xl font-bold uppercase tracking-tighter">Police Record</h1>
                <p className="text-sm uppercase tracking-[0.3em] mt-2" style={{ opacity: 0.4 }}>Official Digitized Archive</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase" style={{ opacity: 0.3 }}>Record Reference</p>
                <p className="font-mono text-2xl font-bold">#{selectedDoc?.id.split('-')[0]}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-16 mb-16">
              <div style={{ borderLeft: '4px solid #000000', paddingLeft: '24px' }}>
                <h2 className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ opacity: 0.3 }}>Subject Name</h2>
                <p className="text-2xl font-bold">{selectedDoc?.subjectName}</p>
              </div>
              <div style={{ borderLeft: '4px solid #e5e5e5', paddingLeft: '24px' }}>
                <h2 className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ opacity: 0.3 }}>Date Digitized</h2>
                <p className="text-2xl font-medium">{new Date(selectedDoc?.date || '').toLocaleDateString()}</p>
              </div>
            </div>

            <div className="mb-16">
              <h2 className="text-[10px] font-bold uppercase tracking-widest mb-6" style={{ opacity: 0.3 }}>Original Document Evidence</h2>
              <img 
                src={selectedDoc?.imageUrl} 
                className="w-full rounded-lg shadow-sm" 
                style={{ border: '1px solid #e5e5e5' }}
                alt="Original"
                referrerPolicy="no-referrer"
              />
            </div>

            <div className="mb-16">
              <h2 className="text-[10px] font-bold uppercase tracking-widest mb-6" style={{ opacity: 0.3 }}>AI Executive Summary ({exportContent.targetLang})</h2>
              <div className="p-8 rounded-2xl italic text-xl leading-relaxed" style={{ backgroundColor: '#f8f9fa', border: '1px solid #f0f0f0', fontFamily: 'serif' }}>
                {exportContent.summary}
              </div>
            </div>

            <div>
              <h2 className="text-[10px] font-bold uppercase tracking-widest mb-6" style={{ opacity: 0.3 }}>Full Transcription ({exportContent.targetLang})</h2>
              <div className="whitespace-pre-wrap text-lg leading-relaxed font-sans">
                {exportContent.text}
              </div>
            </div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {(isUploading || isTranslating) && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] bg-brand-bg/90 backdrop-blur-2xl flex flex-col items-center justify-center"
            >
              <div className="relative mb-12">
                <div className="w-24 h-24 border border-brand-accent/5 rounded-full animate-ping absolute inset-0" />
                <div className="w-24 h-24 border border-brand-accent/10 rounded-full animate-pulse flex items-center justify-center">
                  <Loader2 className="animate-spin text-brand-accent" size={32} strokeWidth={1.5} />
                </div>
              </div>
              <div className="micro-label mb-4">{isUploading ? 'Neural Analysis' : 'Linguistic Processing'}</div>
              <h2 className="title-display text-4xl">
                {isUploading ? 'Digitizing Archive' : 'Translating Record'}
              </h2>
              <p className="text-sm text-brand-muted mt-8 max-w-xs text-center leading-relaxed font-medium">
                {isUploading ? 'Our AI is deciphering handwriting and context to create a structured digital record.' : 'Maintaining semantic accuracy while converting the transcription to your target language.'}
              </p>
            </motion.div>
          )}

          {(view === 'list' || view === 'admin') && (
            <motion.div 
              key={view}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="p-6 sm:p-12 max-w-7xl mx-auto w-full"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between mb-8 sm:mb-12 gap-8">
                <div className="flex flex-col gap-4">
                  {view !== 'admin' && (
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-brand-accent animate-pulse" />
                      <span className="micro-label">System Active</span>
                    </div>
                  )}
                  <h2 className={cn(
                    "font-serif italic tracking-tighter leading-[0.85]",
                    view === 'admin' ? "text-3xl sm:text-5xl" : "text-4xl sm:text-6xl"
                  )}>
                    {view === 'admin' ? 'Global' : 'Personal'}<br />
                    <span className="text-brand-accent/20">Archive</span>
                  </h2>
                </div>
                {view !== 'admin' && (
                  <div className="text-left sm:text-right border-l sm:border-l border-brand-border pl-8 sm:pl-12">
                    <p className="micro-label mb-2">Total Records</p>
                    <p className="text-4xl sm:text-5xl font-mono font-bold tracking-tighter">{documents.length}</p>
                  </div>
                )}
              </div>

              {view === 'admin' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
                  {[
                    { label: 'Total Records', value: stats.total, color: 'bg-brand-accent text-brand-bg' },
                    { label: 'English Records', value: stats.english, color: 'bg-brand-bg text-brand-ink' },
                    { label: 'Telugu Records', value: stats.telugu, color: 'bg-brand-bg text-brand-ink' },
                    { label: 'Hindi Records', value: stats.hindi, color: 'bg-brand-bg text-brand-ink' },
                  ].map((stat, i) => (
                    <div key={i} className={cn("p-6 rounded-xl border border-brand-border shadow-sm", stat.color)}>
                      <p className="micro-label opacity-60 mb-2">{stat.label}</p>
                      <p className="text-3xl font-mono font-bold tracking-tighter">{stat.value}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between mb-6">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2 px-4 py-2 bg-brand-bg border border-brand-border rounded-lg">
                    <Filter size={14} className="text-brand-muted" />
                    <select 
                      value={filterLanguage}
                      onChange={(e) => setFilterLanguage(e.target.value)}
                      className="text-[10px] font-bold uppercase tracking-widest bg-transparent focus:outline-none cursor-pointer text-brand-ink"
                    >
                      <option value="All" className="bg-brand-bg text-brand-ink">All Languages</option>
                      <option value="English" className="bg-brand-bg text-brand-ink">English</option>
                      <option value="Telugu" className="bg-brand-bg text-brand-ink">Telugu</option>
                      <option value="Hindi" className="bg-brand-bg text-brand-ink">Hindi</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 px-4 py-2 bg-brand-bg border border-brand-border rounded-lg">
                    <Filter size={14} className="text-brand-muted" />
                    <select 
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="text-[10px] font-bold uppercase tracking-widest bg-transparent focus:outline-none cursor-pointer text-brand-ink"
                    >
                      <option value="All" className="bg-brand-bg text-brand-ink">All Status</option>
                      <option value="processed" className="bg-brand-bg text-brand-ink">Digitized</option>
                      <option value="pending" className="bg-brand-bg text-brand-ink">Pending</option>
                    </select>
                  </div>
                </div>
              </div>

              {documents.length === 0 ? (
                <div className="border border-brand-border rounded-[2rem] sm:rounded-[3rem] p-12 sm:p-32 flex flex-col items-center justify-center text-center bg-brand-bg/30 backdrop-blur-sm">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 bg-brand-accent/5 rounded-full flex items-center justify-center mb-6 sm:mb-8">
                    <Upload size={24} className="text-brand-accent/20" />
                  </div>
                  <h3 className="text-xl sm:text-2xl font-serif italic">No records digitized yet</h3>
                  <p className="text-xs sm:text-sm text-brand-muted mt-4 max-w-xs mx-auto leading-relaxed">
                    Upload your first handwritten document to begin the AI-powered digitization process.
                  </p>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-primary mt-8 sm:mt-10 px-6 sm:px-8"
                  >
                    <Plus size={18} strokeWidth={3} />
                    Start First Scan
                  </button>
                </div>
              ) : (
                <div className="border border-brand-border rounded-xl overflow-hidden bg-brand-bg shadow-2xl shadow-black/[0.02]">
                  <div className={cn(
                    "hidden sm:grid p-6 border-b border-brand-border bg-brand-bg/50",
                    view === 'admin' ? "grid-cols-[100px_1.2fr_1.8fr_1fr_1fr_120px]" : "grid-cols-[100px_1.5fr_2fr_1fr_1fr]"
                  )}>
                    <span className="col-header">ID</span>
                    <span className="col-header">Subject</span>
                    <span className="col-header">Title & Summary</span>
                    <span className="col-header">Language</span>
                    <span className="col-header">Status</span>
                    {view === 'admin' && <span className="col-header">Actions</span>}
                  </div>
                  <div className="divide-y divide-brand-border">
                    {filteredDocs.map((doc) => (
                      <div 
                        key={doc.id} 
                        className={cn(
                          "flex flex-col sm:grid p-6 transition-all duration-500 hover:bg-brand-accent hover:text-brand-bg cursor-pointer group gap-4 sm:gap-0",
                          view === 'admin' ? "sm:grid-cols-[100px_1.2fr_1.8fr_1fr_1fr_120px]" : "sm:grid-cols-[100px_1.5fr_2fr_1fr_1fr]"
                        )}
                        onClick={() => {
                          setSelectedDoc(doc);
                          setView('detail');
                        }}
                      >
                        <div className="flex flex-row sm:flex-col justify-between sm:justify-center items-center sm:items-start">
                          <span className="data-value group-hover:text-brand-bg/70">#{doc.id.split('-')[0]}</span>
                          <span className="text-[9px] font-bold text-brand-muted group-hover:text-brand-bg/40 sm:mt-1 uppercase tracking-wider">{new Date(doc.date).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center">
                          <span className="font-bold text-sm tracking-tight">{doc.subjectName}</span>
                        </div>
                        <div className="flex flex-col sm:pr-10 justify-center">
                          <span className="font-bold text-sm tracking-tight">{doc.title}</span>
                          <span className="text-[11px] text-brand-muted group-hover:text-brand-bg/60 line-clamp-2 sm:line-clamp-1 mt-1 leading-relaxed font-medium">{doc.summary}</span>
                        </div>
                        <div className="flex items-center gap-4 sm:gap-0">
                          <div className="flex items-center gap-2 px-3 py-1 bg-brand-bg group-hover:bg-white/10 rounded-full border border-brand-border group-hover:border-white/20">
                            <Languages size={10} className="text-brand-muted group-hover:text-brand-bg/40" />
                            <span className="text-[9px] font-bold uppercase tracking-widest">{doc.language}</span>
                          </div>
                          <div className="sm:hidden">
                            {doc.status === 'processed' ? (
                              <div className="status-badge text-emerald-600 bg-emerald-50 border-emerald-100 group-hover:bg-brand-bg/10 group-hover:text-brand-bg group-hover:border-brand-bg/20">
                                <CheckCircle2 size={10} />
                                <span>Digitized</span>
                              </div>
                            ) : (
                              <div className="status-badge text-amber-600 bg-amber-50 border-amber-100 group-hover:bg-brand-bg/10 group-hover:text-brand-bg group-hover:border-brand-bg/20">
                                <Clock size={10} />
                                <span>Pending</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="hidden sm:flex items-center">
                          {doc.status === 'processed' ? (
                            <div className="status-badge text-emerald-600 bg-emerald-50 border-emerald-100 group-hover:bg-brand-bg/10 group-hover:text-brand-bg group-hover:border-brand-bg/20">
                              <CheckCircle2 size={10} />
                              <span>Digitized</span>
                            </div>
                          ) : (
                            <div className="status-badge text-amber-600 bg-amber-50 border-amber-100 group-hover:bg-brand-bg/10 group-hover:text-brand-bg group-hover:border-brand-bg/20">
                              <Clock size={10} />
                              <span>Pending</span>
                            </div>
                          )}
                        </div>
                        {view === 'admin' && (
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <button 
                              onClick={() => {
                                setSelectedDoc(doc);
                                setView('detail');
                              }}
                              className="p-2 rounded-lg bg-brand-bg group-hover:bg-brand-bg/10 border border-brand-border group-hover:border-brand-bg/20 text-brand-muted group-hover:text-brand-bg transition-all"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button 
                              onClick={() => deleteDocument(doc.id)}
                              className="p-2 rounded-lg bg-red-50 group-hover:bg-red-500/20 border border-red-100 group-hover:border-brand-bg/20 text-red-600 group-hover:text-brand-bg transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'detail' && selectedDoc && (
            <motion.div 
              key="detail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col overflow-y-auto lg:overflow-hidden"
            >
              <div className="min-h-[6rem] sm:h-24 border-b border-brand-border px-6 sm:px-12 flex flex-col sm:flex-row items-center justify-center sm:justify-between bg-brand-bg/80 backdrop-blur-2xl py-4 sm:py-0 gap-4 sm:gap-0 sticky top-0 z-40">
                <div className="flex items-center gap-4 sm:gap-8 w-full sm:w-auto">
                  <button 
                    onClick={() => setView(isAdmin ? 'admin' : 'list')}
                    className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center bg-brand-bg hover:bg-brand-ink hover:text-brand-bg rounded-full transition-all active:scale-90 flex-shrink-0"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="flex flex-col min-w-0">
                    <h2 className="font-bold text-base sm:text-lg tracking-tight truncate">{selectedDoc.title}</h2>
                    <div className="flex items-center gap-2 sm:gap-3">
                      <span className="micro-label text-[8px] sm:text-[10px]">Record #{selectedDoc.id.split('-')[0]}</span>
                      <div className="w-1 h-1 rounded-full bg-brand-border" />
                      <span className="micro-label text-[8px] sm:text-[10px]">{new Date(selectedDoc.date).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto justify-end">
                  <button 
                    onClick={() => deleteDocument(selectedDoc.id)}
                    className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center text-brand-muted hover:text-red-500 hover:bg-red-50 rounded-full transition-all active:scale-90"
                    title="Delete Record"
                  >
                    <Trash2 size={16} />
                  </button>
                  <button 
                    onClick={() => setShowExportModal(true)}
                    className="btn-primary py-2.5 sm:py-3 px-4 sm:px-6 text-[10px] sm:text-xs flex-1 sm:flex-none justify-center"
                  >
                    <Download size={14} strokeWidth={3} />
                    Export PDF
                  </button>
                </div>
              </div>

              <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
                {/* Left: Original Image (Immersive Dark Mode) */}
                <div className="w-full lg:w-1/2 bg-[#0a0a0a] flex flex-col relative overflow-hidden min-h-[400px] lg:min-h-0">
                  {/* Atmospheric Gradients */}
                  <div className="absolute inset-0 pointer-events-none opacity-20">
                    <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_0%,#333,transparent_70%)]" />
                  </div>

                  <div className="px-6 sm:px-8 py-4 border-b border-white/5 flex items-center justify-between relative z-10">
                    <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.3em] text-white/30">Evidence Capture</span>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 px-2 sm:px-3 py-1 bg-white/5 rounded-full border border-white/10">
                        <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                        <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-widest text-white/50">Verified Source</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex-1 overflow-auto p-8 sm:p-16 flex items-start justify-center relative z-10">
                    <motion.div 
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                      className="relative group w-full flex justify-center"
                    >
                      <div className="absolute -inset-8 bg-white/5 blur-3xl rounded-[3rem] opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                      <img 
                        src={selectedDoc.imageUrl} 
                        alt="Original Document" 
                        className="relative max-w-full h-auto shadow-[0_20px_60px_rgba(0,0,0,0.5)] lg:shadow-[0_40px_100px_rgba(0,0,0,0.5)] rounded-sm border border-white/10"
                        referrerPolicy="no-referrer"
                      />
                    </motion.div>
                  </div>
                </div>

                {/* Right: Extracted Text (Editorial Light Mode) */}
                <div className="w-full lg:w-1/2 flex flex-col bg-brand-bg min-h-[500px] lg:min-h-0" ref={pdfContentRef}>
                  <div className="px-6 sm:px-12 py-4 sm:py-6 border-b border-brand-border flex flex-col sm:flex-row items-start sm:items-center justify-between bg-brand-bg/30 gap-4 sm:gap-0">
                    <span className="micro-label">AI Transcription</span>
                    <div className="flex items-center gap-6 sm:gap-8">
                      <div className="flex items-center gap-2 micro-label text-brand-ink/60 text-[8px] sm:text-[10px]">
                        <Languages size={10} />
                        {selectedDoc.language}
                      </div>
                      <div className="flex items-center gap-2 micro-label text-brand-ink/60 text-[8px] sm:text-[10px]">
                        <Clock size={10} />
                        {new Date(selectedDoc.date).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                  
                  {/* Translation Controls */}
                  <div className="px-6 sm:px-12 py-6 sm:py-8 border-b border-brand-border flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8 bg-brand-bg">
                    <span className="micro-label">Quick Translate</span>
                    <div className="flex flex-wrap gap-2 sm:gap-3">
                      {['English', 'Hindi', 'Telugu'].map((lang) => (
                        <button
                          key={lang}
                          onClick={() => handleTranslate(lang)}
                          className="px-4 sm:px-6 py-1.5 sm:py-2 rounded-full border border-brand-border text-[8px] sm:text-[9px] font-bold uppercase tracking-widest hover:bg-brand-accent hover:text-brand-bg hover:border-brand-accent transition-all duration-300 active:scale-95"
                        >
                          {lang}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 sm:p-16">
                    <div className="max-w-2xl mx-auto">
                      <motion.div 
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="mb-8 sm:mb-16 p-6 sm:p-10 bg-brand-bg rounded-[1.5rem] sm:rounded-[2.5rem] border border-brand-border relative overflow-hidden group"
                      >
                        <div className="absolute top-0 right-0 p-4 sm:p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity duration-700">
                          <FileText size={60} />
                        </div>
                        <h3 className="micro-label mb-4 sm:mb-6">Executive Summary</h3>
                        <p className="text-lg sm:text-2xl italic font-serif leading-relaxed text-brand-ink/80 selection:bg-brand-accent selection:text-brand-bg">
                          {selectedDoc.summary}
                        </p>
                      </motion.div>
                      
                      <motion.div 
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.4 }}
                        className="prose prose-zinc max-w-none"
                      >
                        <div className="flex items-center justify-between mb-6 sm:mb-8">
                          <h3 className="micro-label m-0">Full Transcription</h3>
                          {isSaving && (
                            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-brand-accent">
                              <Loader2 className="animate-spin" size={12} />
                              Saving...
                            </div>
                          )}
                        </div>
                        <div className="relative group/editor">
                          <textarea 
                            className="w-full min-h-[400px] p-6 bg-brand-bg/30 rounded-2xl border border-transparent focus:border-brand-accent/30 focus:bg-brand-bg focus:ring-4 focus:ring-brand-accent/5 text-sm sm:text-lg leading-relaxed font-sans text-brand-ink/70 selection:bg-brand-accent selection:text-brand-bg transition-all duration-300 resize-y"
                            value={selectedDoc.extractedText}
                            onChange={(e) => updateDocumentText(selectedDoc.id, e.target.value)}
                            placeholder="Extracted text will appear here..."
                          />
                          <div className="absolute top-4 right-4 opacity-0 group-hover/editor:opacity-100 transition-opacity pointer-events-none">
                            <Edit3 size={14} className="text-brand-muted" />
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )
}
        </AnimatePresence>

        {/* Modals & Overlays */}
        <AnimatePresence>
          {showExportModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-brand-ink/60 backdrop-blur-xl flex items-center justify-center p-4 sm:p-6"
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="bg-white rounded-[2rem] sm:rounded-[3rem] p-8 sm:p-12 max-w-lg w-full shadow-[0_60px_120px_rgba(0,0,0,0.3)] border border-white/20 relative overflow-hidden"
              >
                {/* Decorative Background */}
                <div className="absolute top-0 right-0 w-24 h-24 sm:w-32 sm:h-32 bg-brand-bg rounded-full -mr-12 -mt-12 sm:-mr-16 sm:-mt-16 opacity-50" />
                
                <div className="relative z-10">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-brand-bg rounded-xl sm:rounded-2xl flex items-center justify-center text-brand-accent mb-6 sm:mb-10 border border-brand-border">
                    <Download size={24} strokeWidth={1.5} />
                  </div>
                  <h3 className="title-display text-3xl sm:text-4xl mb-4">Export<br />Official Record</h3>
                  <p className="text-xs sm:text-sm text-brand-muted mb-8 sm:mb-12 leading-relaxed font-medium">
                    Select the target language for your official PDF export. The AI will ensure the translation is accurate and formatted for official archives.
                  </p>
                  
                  <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-8 sm:mb-12">
                    {['Original', 'English', 'Hindi', 'Telugu'].map((lang) => (
                      <button
                        key={lang}
                        onClick={() => setExportLanguage(lang)}
                        className={cn(
                          "px-4 sm:px-6 py-4 sm:py-5 rounded-xl sm:rounded-2xl text-[8px] sm:text-[10px] font-bold uppercase tracking-[0.2em] transition-all duration-300 flex items-center justify-between border",
                          exportLanguage === lang 
                            ? "bg-brand-accent text-brand-bg border-brand-accent shadow-2xl shadow-brand-accent/20 scale-[1.02]" 
                            : "bg-brand-bg text-brand-muted border-brand-border hover:border-brand-accent/20"
                        )}
                      >
                        {lang}
                        {exportLanguage === lang && <CheckCircle2 size={12} />}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                    <button 
                      onClick={() => setShowExportModal(false)}
                      className="flex-1 btn-secondary py-4 sm:py-5 justify-center"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={() => handleExportPDF(exportLanguage)}
                      disabled={isExporting}
                      className="flex-[1.5] btn-primary py-4 sm:py-5 justify-center"
                    >
                      {isExporting ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} strokeWidth={2.5} />}
                      <span>{isExporting ? 'Generating...' : 'Download PDF'}</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {uploadError && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 sm:bottom-10 left-4 right-4 sm:left-1/2 sm:-translate-x-1/2 sm:w-auto bg-red-600 text-white px-6 sm:px-8 py-4 rounded-xl sm:rounded-2xl shadow-2xl flex items-center gap-4 z-50 border border-red-500"
          >
            <AlertCircle size={20} className="flex-shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-[8px] sm:text-[10px] font-bold uppercase tracking-widest opacity-70">System Error</span>
              <span className="text-xs sm:text-sm font-medium truncate">{uploadError}</span>
            </div>
            <button 
              onClick={() => setUploadError(null)} 
              className="ml-auto sm:ml-4 w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </main>
    </div>
  );
}
