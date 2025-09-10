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
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
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
      // Mark user message as sent
      setMessages(prev => prev.map(msg => 
        msg.id === userMessage.id ? { ...msg, status: 'sent' } : msg
      ));

      // Send to backend
      const response = await chatService.sendMessage({
        sessionId,
        message: content.trim(),
        messages: messages
      });

      if (response.success && response.data) {
        const assistantMessage: Message = {
          id: uuidv4(),
          content: response.data.message,
          role: 'assistant',
          timestamp: new Date(),
          status: 'sent'
        };

        setMessages(prev => [...prev, assistantMessage]);
      } else {
        throw new Error(response.error || 'Erro ao enviar mensagem');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Mark user message as error
      setMessages(prev => prev.map(msg => 
        msg.id === userMessage.id ? { ...msg, status: 'error' } : msg
      ));

      // Add error message
      const errorMessage: Message = {
        id: uuidv4(),
        content: 'Desculpe, houve um erro ao processar sua mensagem. Tente novamente.',
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