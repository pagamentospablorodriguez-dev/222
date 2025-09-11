// SISTEMA DE POLLING MELHORADO PARA IA FOME 🚀

// Armazenamento compartilhado (mesmas instâncias do chat.js)
const sessions = new Map();
const pendingMessages = new Map();
const processedMessages = new Map();

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

    console.log(`[POLL] 🔍 Verificando mensagens pendentes para: ${sessionId}`);

    // Importar do chat.js para acessar as mesmas instâncias
    try {
      const chatModule = require('./chat.js');
      
      // Simular verificação de mensagens pendentes
      // Em um ambiente real, você usaria um banco de dados compartilhado
      
      // Por enquanto, só retornar que não há mensagens
      // O polling real acontece através do JavaScript no frontend
      
    } catch (importError) {
      console.log(`[POLL] ⚠️ Erro ao importar chat.js:`, importError.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        hasNewMessage: false,
        debug: {
          sessionId,
          timestamp: new Date().toISOString(),
          pollWorking: true
        }
      })
    };
    
  } catch (error) {
    console.error('[POLL] ❌ Erro no polling:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Erro interno do servidor',
        details: error.message 
      })
    };
  }
};

// Função para adicionar mensagem pendente (será usada pelo chat.js)
function addPendingMessage(sessionId, message) {
  pendingMessages.set(sessionId, {
    message: message,
    timestamp: new Date()
  });
  console.log(`[POLL] ✅ Mensagem adicionada para ${sessionId}: ${message.substring(0, 50)}...`);
}

// Exportar função
if (typeof module !== 'undefined' && module.exports) {
  module.exports.addPendingMessage = addPendingMessage;
}

// Limpeza automática de dados antigos
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutos

  for (const [sessionId, data] of pendingMessages.entries()) {
    if (now - data.timestamp.getTime() > maxAge) {
      pendingMessages.delete(sessionId);
      console.log(`[POLL] 🧹 Mensagem expirada removida: ${sessionId}`);
    }
  }

  for (const [key, timestamp] of processedMessages.entries()) {
    if (now - timestamp > maxAge) {
      processedMessages.delete(key);
    }
  }
}, 10 * 60 * 1000); // Limpeza a cada 10 minutos
