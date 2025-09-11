import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, Session } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { chatService } from '../services/chatService';

export const useChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => {
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

  // Adicionar nova mensagem da IA
  const addAIMessage = useCallback((content: string) => {
    const assistantMessage: Message = {
      id: uuidv4(),
      content,
      role: 'assistant',
      timestamp: new Date(),
      status: 'sent'
    };
    setMessages(prev => [...prev, assistantMessage]);
  }, []);

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
      // Marcar mensagem como enviada
      setMessages(prev => prev.map(msg =>
        msg.id === userMessage.id ? { ...msg, status: 'sent' } : msg
      ));

      // Enviar para backend
      const response = await chatService.sendMessage({
        sessionId,
        message: content.trim(),
        messages: messages
      });

      if (response.success && response.data) {
        // Resposta imediata da IA
        const assistantMessage: Message = {
          id: uuidv4(),
          content: response.data.message,
          role: 'assistant',
          timestamp: new Date(),
          status: 'sent'
        };

        setMessages(prev => [...prev, assistantMessage]);

        // Verificar se precisa buscar restaurantes
        if (response.data.shouldSearchRestaurants) {
          console.log('Iniciando busca de restaurantes...');
          
          // Aguardar 3 segundos e buscar
          setTimeout(async () => {
            try {
              const searchResponse = await fetch('/.netlify/functions/search-restaurants', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sessionId,
                  orderData: response.data.orderData
                })
              });

              if (searchResponse.ok) {
                const searchData = await searchResponse.json();
                if (searchData.success && searchData.restaurants) {
                  // Construir mensagem com opções
                  let optionsMessage = "🍕 Encontrei ótimas opções para você:\n\n";
                  searchData.restaurants.forEach((rest: any, index: number) => {
                    optionsMessage += `${index + 1}. **${rest.name}**\n`;
                    optionsMessage += `   ${rest.specialty}\n`;
                    optionsMessage += `   ⏰ ${rest.estimatedTime}\n`;
                    optionsMessage += `   💰 ${rest.price}\n\n`;
                  });
                  optionsMessage += "Qual restaurante você prefere? Digite o número! 😊";

                  // Adicionar mensagem automaticamente
                  addAIMessage(optionsMessage);
                }
              }
            } catch (error) {
              console.error('Erro na busca:', error);
              addAIMessage('Desculpe, houve um erro na busca. Tente novamente.');
            }
          }, 3000);
        }
      } else {
        throw new Error(response.error || 'Erro ao enviar mensagem');
      }
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);

      setMessages(prev => prev.map(msg =>
        msg.id === userMessage.id ? { ...msg, status: 'error' } : msg
      ));

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
  }, [sessionId, messages, addAIMessage]);

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
