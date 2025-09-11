// SISTEMA DE POLLING APRIMORADO PARA IA FOME 🚀
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Armazenamento compartilhado OTIMIZADO
const pendingMessages = new Map();
const processedMessages = new Map();
const messageQueue = new Map(); // Fila de mensagens por sessão

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { sessionId } = JSON.parse(event.body);

    if (!sessionId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'SessionId é obrigatório' })
      };
    }

    console.log(`[POLL] 🔍 Verificando mensagens para: ${sessionId}`);

    // Verificar mensagens pendentes
    const pendingMessage = pendingMessages.get(sessionId);
    
    if (pendingMessage && !processedMessages.has(`${sessionId}-${pendingMessage.timestamp.getTime()}`)) {
      
      // Marcar como processada IMEDIATAMENTE
      const messageKey = `${sessionId}-${pendingMessage.timestamp.getTime()}`;
      processedMessages.set(messageKey, true);
      
      // Remover da lista de pendentes
      pendingMessages.delete(sessionId);
      
      console.log(`[POLL] ✅ Mensagem encontrada para ${sessionId}`);
      console.log(`[POLL] 📨 Conteúdo: ${pendingMessage.message.substring(0, 100)}...`);

      // Limpar mensagens processadas antigas (mais de 5 minutos)
      const now = Date.now();
      for (const [key, timestamp] of processedMessages.entries()) {
        if (now - timestamp > 5 * 60 * 1000) {
          processedMessages.delete(key);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          hasNewMessage: true,
          message: pendingMessage.message,
          timestamp: pendingMessage.timestamp,
          restaurants: pendingMessage.restaurants || null
        })
      };
    }

    // Verificar fila de mensagens múltiplas
    const queuedMessages = messageQueue.get(sessionId);
    if (queuedMessages && queuedMessages.length > 0) {
      const nextMessage = queuedMessages.shift();
      
      if (queuedMessages.length === 0) {
        messageQueue.delete(sessionId);
      }
      
      console.log(`[POLL] 📮 Mensagem da fila para ${sessionId}`);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          hasNewMessage: true,
          message: nextMessage.message,
          timestamp: nextMessage.timestamp
        })
      };
    }

    // Nenhuma mensagem pendente
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        hasNewMessage: false
      })
    };
    
  } catch (error) {
    console.error('[POLL] ❌ Erro no polling:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};

// FUNÇÃO PREMIUM para adicionar mensagem pendente
function addPendingMessage(sessionId, message, restaurants = null) {
  const messageData = {
    message: message,
    timestamp: new Date(),
    restaurants: restaurants
  };
  
  pendingMessages.set(sessionId, messageData);
  console.log(`[POLL] ✅ Mensagem premium adicionada para ${sessionId}`);
  console.log(`[POLL] 📨 Preview: ${message.substring(0, 50)}...`);
}

// Função para adicionar múltiplas mensagens em sequência
function addMessageSequence(sessionId, messages) {
  const queue = messageQueue.get(sessionId) || [];
  
  messages.forEach(msg => {
    queue.push({
      message: msg,
      timestamp: new Date()
    });
  });
  
  messageQueue.set(sessionId, queue);
  console.log(`[POLL] 📮 ${messages.length} mensagens adicionadas à fila de ${sessionId}`);
}

// Exportar funções para uso em outros arquivos
if (typeof module !== 'undefined' && module.exports) {
  module.exports.addPendingMessage = addPendingMessage;
  module.exports.addMessageSequence = addMessageSequence;
}

// Limpeza automática de dados antigos (executa a cada 10 minutos)
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutos
  
  // Limpar mensagens pendentes antigas
  for (const [sessionId, data] of pendingMessages.entries()) {
    if (now - data.timestamp.getTime() > maxAge) {
      pendingMessages.delete(sessionId);
      console.log(`[POLL] 🧹 Mensagem expirada removida: ${sessionId}`);
    }
  }
  
  // Limpar mensagens processadas antigas
  for (const [key, timestamp] of processedMessages.entries()) {
    if (now - timestamp > maxAge) {
      processedMessages.delete(key);
    }
  }
  
  // Limpar filas vazias
  for (const [sessionId, queue] of messageQueue.entries()) {
    if (queue.length === 0) {
      messageQueue.delete(sessionId);
    }
  }
}, 10 * 60 * 1000);
