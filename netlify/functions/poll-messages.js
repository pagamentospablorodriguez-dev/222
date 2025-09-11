// SISTEMA DE POLLING CRÍTICO - FUNCIONANDO 100%! 🚀
const { GoogleGenerativeAI } = require('@google/generative-ai');

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

    console.log(`[POLL] 🔍 VERIFICANDO: ${sessionId}`);

    // USAR STORAGE GLOBAL - COMPARTILHADO COM CHAT.JS!
    global.pendingMessages = global.pendingMessages || new Map();
    global.processedMessages = global.processedMessages || new Map();

    // Verificar mensagens pendentes
    const pendingMessage = global.pendingMessages.get(sessionId);
    
    if (pendingMessage) {
      const messageKey = `${sessionId}-${pendingMessage.timestamp.getTime()}`;
      
      // Verificar se já foi processada
      if (!global.processedMessages.has(messageKey)) {
        
        // Marcar como processada
        global.processedMessages.set(messageKey, true);
        
        // Remover da lista de pendentes
        global.pendingMessages.delete(sessionId);
        
        console.log(`[POLL] ✅ MENSAGEM ENCONTRADA para ${sessionId}`);
        console.log(`[POLL] 📨 Enviando: ${pendingMessage.message.substring(0, 50)}...`);

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
    }

    // Nenhuma mensagem pendente
    console.log(`[POLL] 📭 Nada pendente para ${sessionId}`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        hasNewMessage: false
      })
    };
    
  } catch (error) {
    console.error('[POLL] ❌ ERRO:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};

// Limpeza automática a cada 5 minutos
setInterval(() => {
  if (global.processedMessages) {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutos
    
    for (const [key, timestamp] of global.processedMessages.entries()) {
      if (now - timestamp > maxAge) {
        global.processedMessages.delete(key);
      }
    }
  }
}, 5 * 60 * 1000);
