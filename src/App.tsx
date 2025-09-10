
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ChatInterface from './components/ChatInterface';
import Header from './components/Header';
import ThemeToggle from './components/ThemeToggle';

function App() {
  const [isInitialState, setIsInitialState] = useState(true);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check for saved theme preference or default to light mode
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    setIsDark(!isDark);
    if (!isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const handleFirstMessage = () => {
    setIsInitialState(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-orange-50/30 to-red-50/20 dark:from-dark-950 dark:via-dark-900 dark:to-dark-800 transition-colors duration-500">
      <ThemeToggle isDark={isDark} onToggle={toggleTheme} />
      
      <AnimatePresence mode="wait">
        {isInitialState ? (
          <motion.div
            key="initial"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="min-h-screen flex items-center justify-center px-4 py-8"
          >
            <ChatInterface 
              isInitialState={isInitialState} 
              onFirstMessage={handleFirstMessage}
            />
          </motion.div>
        ) : (
          <motion.div
            key="chat"
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="min-h-screen flex flex-col"
          >
            <Header isInitialState={isInitialState} />
            <div className="flex-1 flex flex-col">
              <ChatInterface 
                isInitialState={isInitialState} 
                onFirstMessage={handleFirstMessage}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;