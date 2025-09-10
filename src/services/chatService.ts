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
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  async sendMessage(request: SendMessageRequest): Promise<ApiResponse<SendMessageResponse>> {
    try {
      const response = await this.api.post('/chat', request);
      return {
        success: true,
        data: response.data
      };
    } catch (error: any) {
      console.error('Chat service error:', error);
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Erro na comunicação com o servidor'
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.api.get('/health');
      return true;
    } catch {
      return false;
    }
  }
}

export const chatService = new ChatService();