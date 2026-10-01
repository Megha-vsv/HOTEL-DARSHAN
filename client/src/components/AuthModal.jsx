import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { X, User, Lock, Phone, Mail, LogOut, CheckCircle2, ShieldCheck, Utensils, Truck } from 'lucide-react';

export default function AuthModal({ isOpen, onClose }) {
  const { language, t } = useLanguage();
  const { user, logout } = useAuth();

  const [mode, setMode] = useState('profile'); // 'profile', 'login', 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
        onClose();
      } else if (mode === 'register') {
        await register(name, email, phone, password);
        onClose();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-neutral-200 relative animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {user ? (
          /* Profile & Quick Persona Switcher */
          <div className="space-y-5">
            <div className="text-center pt-2">
              <div className="w-16 h-16 rounded-full bg-red-100 text-[#e53935] flex items-center justify-center mx-auto text-xl font-black mb-2 shadow-inner">
                {user.name?.slice(0, 2).toUpperCase()}
              </div>
              <h3 className="font-black text-lg text-neutral-900">{user.name}</h3>
              <p className="text-xs text-neutral-500">{user.email} • {user.phone}</p>
              <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-red-100 text-[#e53935]">
                {user.role}
              </span>
            </div>

            <div className="pt-2 flex justify-between">
              <button
                onClick={() => {
                  logout();
                  setMode('login');
                }}
                className="w-full py-2.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold flex items-center justify-center gap-1.5 transition"
              >
                <LogOut className="w-4 h-4" />
                <span>{t('logout')}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center">
            <p className="text-sm text-neutral-600">Please use the mobile OTP login screen to access Hotel Darshan.</p>
          </div>
        )}
      </div>
    </div>
  );
}
