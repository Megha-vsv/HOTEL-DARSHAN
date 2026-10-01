import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, getItemField } from '../i18n/translations';

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try {
      return localStorage.getItem('hotel_darshan_lang') || 'en';
    } catch {
      localStorage.removeItem('hotel_darshan_lang');
      return 'en';
    }
  });

  const setLanguage = (lang) => {
    if (['en', 'hi', 'gu'].includes(lang)) {
      setLanguageState(lang);
      localStorage.setItem('hotel_darshan_lang', lang);
    }
  };

  const t = (key) => {
    const dict = translations[language] || translations.en;
    return dict[key] || translations.en[key] || key;
  };

  const itemText = (item, fieldPrefix) => {
    return getItemField(item, fieldPrefix, language);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, itemText }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
