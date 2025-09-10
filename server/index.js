import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Google AI Configuration
const genAI = new GoogleGenerativeAI('');

// In-memory session storage (in production, use a database)
const sessions = new Map();

// System prompt for IA Fome
const SYSTEM_PROMPT = `
Você é o IA Fome, um assistente inteligente especializado em pedidos de comida por delivery. Você funciona como um concierge particular premium, oferecendo o melhor atendimento personalizado possível.

MISSÃO: Revolucionar como as pessoas pedem comida online, tornando o processo simples, rápido e sem fricção.

PERSONALIDADE:
- Atencioso e prestativo como um concierge de hotel 5 estrelas
- Proativo em sugerir opções e melhorias
- Eficiente e profissional, mas amigável
- Focado em resolver tudo para o cliente

PROCESSO DE ATENDIMENTO:

1. RECEPÇÃO DO PEDIDO:
   - Cumprimente o cliente de forma calorosa
   - Identifique o que eles querem comer
   - Seja específico sobre quantidades, tamanhos, sabores

2. COLETA DE INFORMAÇÕES:
   - Endereço de entrega (rua, número, bairro, cidade)
   - Número de WhatsApp do cliente
   - Preferências específicas ou restrições

3. BUSCA DE RESTAURANTES:
   - Informe que está buscando as melhores opções na região
   - Explique os critérios de seleção (qualidade, avaliação, tempo de entrega)

4. APRESENTAÇÃO DE OPÇÕES:
   - Apresente 1-3 opções de restaurantes
   - Inclua nome, especialidade, tempo estimado
   - Mencione preços estimados quando possível

5. CONFIRMAÇÃO E PEDIDO:
   - Confirme todos os detalhes do pedido
   - Método de pagamento (padrão: dinheiro na entrega)
   - Confirme se precisa de troco

6. ACOMPANHAMENTO:
   - Informe que está entrando em contato com o restaurante
   - Atualize sobre confirmação do pedido
   - Informe tempo de preparo e entrega

DIRETRIZES IMPORTANTES:
- SEMPRE mantenha a conversa focada em comida e delivery
- Seja proativo em perguntar detalhes importantes
- Ofereça sugestões relevantes (bebidas, sobremesas, acompanhamentos)
- Mantenha um tom profissional mas descontraído
- Se não souber alguma informação específica, seja honesto
- NUNCA invente informações sobre restaurantes ou preços
- Sempre confirme dados importantes como endereço e telefone

EXEMPLO DE ATENDIMENTO:
Cliente: "Quero uma pizza"
Você: "Perfeito! Vou te ajudar com isso. Para encontrar as melhores pizzarias da sua região, preciso de algumas informações:

🍕 Que tamanho de pizza você prefere? (pequena, média, grande, família)
🧀 Qual sabor você tem em mente?
🥤 Vai querer alguma bebida para acompanhar?
📍 Qual o seu endereço para entrega?
📱 Qual seu WhatsApp para eu manter você atualizado?

Com essas informações, vou encontrar as melhores opções na sua região!"

Lembre-se: Você é o diferencial que torna o IA Fome único. Ofereça uma experiência premium que faça o cliente nunca mais querer usar outros aplicativos de delivery!
`;

// AI Service
class IAFomeService {
  constructor() {
    this.model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async generateResponse(sessionId, userMessage, conversationHistory) {
    try {
      // Build conversation context
      let context = SYSTEM_PROMPT + "\n\nHistórico da conversa:\n";
      
      conversationHistory.forEach(msg => {
        context += `${msg.role === 'user' ? 'Cliente' : 'IA Fome'}: ${msg.content}\n`;
      });
      
      context += `Cliente: ${userMessage}\nIA Fome:`;

      const result = await this.model.generateContent(context);
      const response = result.response;
      const text = response.text();

      return {
        success: true,
        message: text.trim()
      };
    } catch (error) {
      console.error('Error generating AI response:', error);
      return {
        success: false,
        error: 'Erro ao processar mensagem com a IA'
      };
    }
  }
}

const iaFomeService = new IAFomeService();

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message, messages = [] } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({
        error: 'SessionId e message são obrigatórios'
      });
    }

    // Get or create session
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        messages: [],
        created: new Date(),
        lastActive: new Date()
      };
      sessions.set(sessionId, session);
    }

    // Update session
    session.lastActive = new Date();
    session.messages = messages;

    // Generate AI response
    const aiResponse = await iaFomeService.generateResponse(
      sessionId,
      message,
      messages
    );

    if (!aiResponse.success) {
      throw new Error(aiResponse.error);
    }

    // Update session with new messages
    session.messages.push(
      {
        id: uuidv4(),
        content: message,
        role: 'user',
        timestamp: new Date()
      },
      {
        id: uuidv4(),
        content: aiResponse.message,
        role: 'assistant',
        timestamp: new Date()
      }
    );

    sessions.set(sessionId, session);

    res.json({
      message: aiResponse.message,
      sessionId: sessionId
    });

  } catch (error) {
    console.error('Chat endpoint error:', error);
    res.status(500).json({
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Restaurant search endpoint (placeholder)
app.post('/api/search-restaurants', async (req, res) => {
  try {
    const { location, query } = req.body;
    
    // TODO: Implement Google Places API integration
    // For now, return mock data
    const mockRestaurants = [
      {
        id: '1',
        name: 'Pizzaria Dom José',
        phone: '(11) 99999-1234',
        address: 'Rua das Pizzas, 123',
        rating: 4.5,
        specialty: 'Pizza tradicional',
        estimatedTime: '40-50 min'
      },
      {
        id: '2',
        name: 'Pizza Express',
        phone: '(11) 99999-5678',
        address: 'Av. dos Sabores, 456',
        rating: 4.2,
        specialty: 'Pizza gourmet',
        estimatedTime: '35-45 min'
      }
    ];

    res.json({
      success: true,
      restaurants: mockRestaurants
    });

  } catch (error) {
    console.error('Restaurant search error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// WhatsApp integration endpoint (placeholder)
app.post('/api/whatsapp/send', async (req, res) => {
  try {
    const { phone, message } = req.body;
    
    // TODO: Implement Evolution API or Z-API integration
    console.log('WhatsApp message would be sent:', { phone, message });
    
    res.json({
      success: true,
      messageId: uuidv4()
    });

  } catch (error) {
    console.error('WhatsApp send error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Session cleanup (runs every hour)
setInterval(() => {
  const now = new Date();
  const oneHour = 60 * 60 * 1000;
  
  for (const [sessionId, session] of sessions) {
    if (now - session.lastActive > oneHour) {
      sessions.delete(sessionId);
    }
  }
}, 60 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 IA Fome server running on port ${PORT}`);
  console.log(`🤖 Gemini AI integrated and ready`);
  console.log(`📱 WhatsApp integration ready for setup`);
  console.log(`🍕 Ready to revolutionize food delivery!`);
});

export default app;
