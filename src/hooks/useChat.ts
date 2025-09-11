import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, Session } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { chatService } from '../services/chatService';

export const useChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => {
    // Recuperar sessionId do localStorage ou criar novo
    const saved = localStorage.getItem('ia-fome-session-id');
    return saved || uuidv4();
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Salvar sessionId no localStorage
  useEffect(() => {
    localStorage.setItem('ia-fome-session-id', sessionId);
  }, [sessionId]);

  // Carregar mensagens salvas
  useEffect(() => {
    const savedMessages = localStorage.getItem(`ia-fome-messages-${sessionId}`);
    if (savedMessages) {
      try {
        const parsed = JSON.parse(savedMessages);
        setMessages(parsed.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        })));
      } catch (error) {
        console.error('Erro ao carregar mensagens:', error);
      }
    }
  }, [sessionId]);

  // Salvar mensagens no localStorage
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`ia-fome-messages-${sessionId}`, JSON.stringify(messages));
    }
  }, [messages, sessionId]);

  // SISTEMA DE POLLING MELHORADO para mensagens automáticas
  useEffect(() => {
    let pollInterval: NodeJS.Timeout;

    const startPolling = () => {
      pollInterval = setInterval(async () => {
        try {
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
              console.log('🚀 Nova mensagem automática recebida:', data.message.substring(0, 50));
              
              // Criar nova mensagem da IA
              const newMessage: Message = {
                id: uuidv4(),
                content: data.message,
                role: 'assistant',
                timestamp: new Date(data.timestamp),
                status: 'sent'
              };
              
              // Adicionar mensagem ao estado
              setMessages(prev => {
                // Verificar se já existe mensagem com o mesmo conteúdo
                const exists = prev.some(msg => 
                  msg.content === newMessage.content && 
                  msg.role === 'assistant'
                );
                
                if (exists) {
                  console.log('Mensagem duplicada ignorada');
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
      }, 1500); // Polling mais frequente (1.5s)
    };

    // Iniciar polling após primeira mensagem
    if (messages.length > 0) {
      startPolling();
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [sessionId, messages.length]);

  // Listener para novas mensagens da IA
  useEffect(() => {
    const handleNewAIMessage = (event: CustomEvent) => {
      const newMessage = event.detail;
      setMessages(prev => {
        // Evitar mensagens duplicadas
        const exists = prev.some(msg => msg.id === newMessage.id);
        if (exists) return prev;
        
        return [...prev, newMessage];
      });
    };

    window.addEventListener('newAIMessage', handleNewAIMessage as EventListener);
    return () => window.removeEventListener('newAIMessage', handleNewAIMessage as EventListener);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 100);

    return () => clearTimeout(timer);
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: uuidv4(),
      content: content.trim(),
      role: 'user',
      timestamp: new Date(),
      status: 'sending'
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      console.log('📤 Enviando mensagem:', content.substring(0, 50));

      // Marcar mensagem do usuário como enviada IMEDIATAMENTE
      setMessages(prev => prev.map(msg =>
        msg.id === userMessage.id ? { ...msg, status: 'sent' } : msg
      ));

      // Enviar para o backend com retry
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
            console.log(`🔄 Tentativa ${attempts + 1}/3 em 1s...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          attempts++;
          if (attempts < 3) {
            console.log(`🔄 Erro na tentativa ${attempts}, tentando novamente...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            throw error;
          }
        }
      }

      if (response?.success && response.data) {
        console.log('✅ Resposta recebida:', response.data.message.substring(0, 50));
        
        const assistantMessage: Message = {
          id: uuidv4(),
          content: response.data.message,
          role: 'assistant',
          timestamp: new Date(),
          status: 'sent'
        };

        setMessages(prev => [...prev, assistantMessage]);
      } else {
        throw new Error(response?.error || 'Erro ao enviar mensagem');
      }
    } catch (error) {
      console.error('❌ Erro ao enviar mensagem:', error);

      // Marcar mensagem do usuário como erro
      setMessages(prev => prev.map(msg =>
        msg.id === userMessage.id ? { ...msg, status: 'error' } : msg
      ));

      // Adicionar mensagem de erro
      const errorMessage: Message = {
        id: uuidv4(),
        content: 'Desculpe, houve um erro. Tente novamente em alguns segundos.',
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
      // Remover mensagem com erro
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
      // Reenviar
      sendMessage(message.content);
    }
  }, [messages, sendMessage]);

  const clearSession = useCallback(() => {
    localStorage.removeItem(`ia-fome-messages-${sessionId}`);
    localStorage.removeItem('ia-fome-session-id');
    setMessages([]);
  }, [sessionId]);

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
