import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, Session } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { chatService } from '../services/chatService';

export const useChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => uuidv4());
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  return {
    messages,
    isLoading,
    sendMessage,
    retryMessage,
    messagesEndRef,
    sessionId
  };
};