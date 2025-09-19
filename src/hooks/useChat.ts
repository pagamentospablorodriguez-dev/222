import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, Session } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { chatService } from '../services/chatService';

export const useChat = () => {
  const [messages, setMessages] = useState<Message[]>(() => {
    // Recuperar mensagens do localStorage
    const saved = localStorage.getItem('ia-fome-messages');
    return saved ? JSON.parse(saved).map((msg: any) => ({
      ...msg,
      timestamp: new Date(msg.timestamp)
    })) : [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => {
    // Recuperar ou criar sessionId
    const saved = localStorage.getItem('ia-fome-session-id');
    return saved || uuidv4();
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, scrollToBottom]);

  // Salvar mensagens no localStorage sempre que mudarem
  useEffect(() => {
    localStorage.setItem('ia-fome-messages', JSON.stringify(messages));
    localStorage.setItem('ia-fome-session-id', sessionId);
  }, [messages, sessionId]);

  // POLLING PARA MENSAGENS AUTOMÁTICAS
  useEffect(() => {
    if (messages.length === 0) return; // Não fazer polling se não há mensagens

    const pollInterval = setInterval(async () => {
      try {
        console.log('🔍 POLLING: Verificando mensagens...');
        
        const response = await fetch('/.netlify/functions/poll-messages', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
          },
          body: JSON.stringify({ sessionId })
        });
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.hasNewMessage && data.message) {
            console.log('🚀 NOVA MENSAGEM AUTOMÁTICA:', data.message.substring(0, 50));
            
            const newMessage: Message = {
              id: uuidv4(),
              content: data.message,
              role: 'assistant',
              timestamp: new Date(data.timestamp || new Date()),
              status: 'sent'
            };
            
            setMessages(prev => {
              // Evitar duplicatas
              const exists = prev.some(msg => 
                msg.content === newMessage.content && 
                msg.role === 'assistant' &&
                Math.abs(new Date(msg.timestamp).getTime() - newMessage.timestamp.getTime()) < 5000
              );
              
              if (exists) {
                console.log('⚠️ Mensagem duplicada ignorada');
                return prev;
              }
              
              console.log('✅ Nova mensagem adicionada ao chat');
              return [...prev, newMessage];
            });
          }
        }
      } catch (error) {
        console.error('❌ Erro no polling:', error);
      }
    }, 2000); // Polling a cada 2 segundos

    return () => clearInterval(pollInterval);
  }, [sessionId, messages.length]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: uuidv4(),
      content: content.trim(),
      role: 'user',
      timestamp: new Date(),
      status: 'sending'
    };

    // 🔄 ADICIONAR A MENSAGEM DO USUÁRIO IMEDIATAMENTE
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      console.log('📤 ENVIANDO:', content.substring(0, 50));

      // Marcar como enviada imediatamente
      setMessages(prev => prev.map(msg =>
        msg.id === userMessage.id ? { ...msg, status: 'sent' } : msg
      ));

      // 🔄 AGUARDAR UM POUCO ANTES DE ENVIAR PARA BACKEND
      await new Promise(resolve => setTimeout(resolve, 500));

      // Enviar para backend com retry
      let attempts = 0;
      let response;
      
      while (attempts < 3) {
        try {
          response = await chatService.sendMessage({
            sessionId,
            message: content.trim(),
            messages: messages.filter(msg => msg.status !== 'sending')
          });
          
          if (response.success) {
            break;
          }
          
          attempts++;
          if (attempts < 3) {
            console.log(`🔄 Retry ${attempts + 1}/3...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          attempts++;
          if (attempts < 3) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            throw error;
          }
        }
      }

      if (response?.success && response.data) {
        console.log('✅ Resposta recebida:', response.data.message.substring(0, 50));
        
        // 🔄 GARANTIR QUE A RESPOSTA DA IA SEJA ADICIONADA AO CHAT
        const assistantMessage: Message = {
          id: uuidv4(),
          content: response.data.message,
          role: 'assistant',
          timestamp: new Date(),
          status: 'sent'
        };

        setMessages(prev => [...prev, assistantMessage]);
        console.log('✅ Mensagem da IA adicionada ao chat');
      } else {
        throw new Error(response?.error || 'Erro ao enviar mensagem');
      }
    } catch (error) {
      console.error('❌ Erro ao enviar:', error);

      // Marcar como erro
      setMessages(prev => prev.map(msg =>
        msg.id === userMessage.id ? { ...msg, status: 'error' } : msg
      ));

      // Adicionar mensagem de erro
      const errorMessage: Message = {
        id: uuidv4(),
        content: 'Ops! Algo deu errado. Pode tentar novamente?',
        role: 'assistant',
        timestamp: new Date(),
        status: 'sent'
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, messages]);

  const retryMessage = useCallback((messageId: string) => {
    const message = messages.find(msg => msg.id === messageId);
    if (message && message.role === 'user') {
      // Remover mensagem com erro e reenviar
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
      sendMessage(message.content);
    }
  }, [messages, sendMessage]);

  const clearSession = useCallback(() => {
    localStorage.removeItem('ia-fome-messages');
    localStorage.removeItem('ia-fome-session-id');
    setMessages([]);
    // 🔄 DISPARAR EVENTO PARA VOLTAR AO ESTADO INICIAL
    window.dispatchEvent(new CustomEvent('ia-fome-new-session'));
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    retryMessage,
    messagesEndRef,
    sessionId,
    clearSession
  };
};
