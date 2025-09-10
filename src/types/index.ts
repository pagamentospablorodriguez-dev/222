export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  status?: 'sending' | 'sent' | 'error';
}

export interface Session {
  id: string;
  messages: Message[];
  userPhone?: string;
  currentOrder?: OrderDetails;
  created: Date;
  lastActive: Date;
}

export interface OrderDetails {
  items: string[];
  address?: string;
  restaurant?: RestaurantInfo;
  totalPrice?: number;
  paymentMethod?: string;
  status: 'processing' | 'confirmed' | 'preparing' | 'on_way' | 'delivered';
}

export interface RestaurantInfo {
  name: string;
  phone: string;
  address: string;
  rating?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}