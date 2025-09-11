import axios from 'axios';
import { ApiResponse, Message } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/.netlify/functions';

interface SendMessageRequest {
  sessionId: string;
  message: string;
  messages: Message[];
}

interface SendMessageResponse {
  message: string;
  sessionId: string;
}

class ChatService {
  private api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 45000, // Aumentar timeout para 45s
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    },
  });

  constructor() {
    // Interceptor para logs detalhados
    this.api.interceptors.request.use(
      (config) => {
        console.log('📡 ENVIANDO REQ:', config.method?.toUpperCase(), config.url);
        return config;
      },
      (error) => {
        console.error('❌ ERRO REQ:', error);
        return Promise.reject(error);
      }
    );

    this.api.interceptors.response.use(
      (response) => {
        console.log('✅ RESP RECEBIDA:', response.status, response.config.url);
        return response;
      },
      (error) => {
        console.error('❌ ERRO RESP:', error.response?.status, error.message);
        return Promise.reject(error);
      }
    );
  }

  async sendMessage(request: SendMessageRequest): Promise<ApiResponse<SendMessageResponse>> {
    try {
      console.log('🚀 ENVIANDO PARA CHAT SERVICE...');
      console.log('📊 DADOS:', {
        sessionId: request.sessionId,
        message: request.message.substring(0, 50) + '...',
        messagesCount: request.messages.length
      });

      const response = await this.api.post('/chat', {
        sessionId: request.sessionId,
        message: request.message,
        messages: request.messages.map(msg => ({
          id: msg.id,
          content: msg.content,
          role: msg.role,
          timestamp: msg.timestamp.toISOString()
        }))
      });

      console.log('✅ RESPOSTA SERVIDOR:', response.data);

      return {
        success: true,
        data: response.data
      };
    } catch (error: any) {
      console.error('❌ ERRO CHAT SERVICE:', error);
      
      let errorMessage = 'Erro na comunicação com o servidor';
      
      if (error.code === 'ECONNABORTED') {
        errorMessage = 'Tempo limite excedido. Tente novamente.';
      } else if (error.response?.status === 429) {
        errorMessage = 'Muitas requisições. Aguarde um momento.';
      } else if (error.response?.status >= 500) {
        errorMessage = 'Servidor temporariamente indisponível.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.api.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  // Método para testar conectividade
  async testConnection(): Promise<{ success: boolean; latency?: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      await this.healthCheck();
      const latency = Date.now() - startTime;
      
      return {
        success: true,
        latency
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export const chatService = new ChatService();
