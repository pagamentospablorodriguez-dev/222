import React from 'react';
import { motion } from 'framer-motion';
import { Bot, Sparkles, ChefHat } from 'lucide-react';

interface HeaderProps {
  isInitialState: boolean;
}

const Header: React.FC<HeaderProps> = ({ isInitialState }) => {
  if (isInitialState) return null;

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="fixed top-0 left-0 right-0 z-40 bg-white/80 dark:bg-dark-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-dark-700/50 px-6 py-4 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.3 }}
          className="flex items-center gap-3"
        >
          <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-accent-500 rounded-xl flex items-center justify-center shadow-lg animate-glow">
            
        <img src="/iafome.png" />
            
          </div>
          <div>
            <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary-600 to-accent-500 dark:from-primary-400 dark:to-accent-400">
              IA Fome
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Seu assistente de delivery</p>
          </div>
        </motion.div>

        <motion.button
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.3 }}
          className="p-2 hover:bg-neutral-50 rounded-lg transition-colors"
        >
          <Sparkles className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        </motion.button>
      </div>
    </motion.header>
  );
};

export default Header;
