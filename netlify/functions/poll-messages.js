const { GoogleGenerativeAI } = require('@google/generative-ai');

// Armazenamento compartilhado (em produção, usar banco de dados)
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

    console.log(`[POLL] Verificando mensagens para: ${sessionId}`);

    // Verificar se há mensagens pendentes para esta sessão
    const pendingMessage = pendingMessages.get(sessionId);
    
    if (pendingMessage && !processedMessages.has(`${sessionId}-${pendingMessage.timestamp.getTime()}`)) {
      // Marcar como processada
      processedMessages.set(`${sessionId}-${pendingMessage.timestamp.getTime()}`, true);
      
      // Remover da lista de pendentes
      pendingMessages.delete(sessionId);
      
      console.log(`[POLL] Mensagem encontrada para ${sessionId}: ${pendingMessage.message.substring(0, 50)}...`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          hasNewMessage: true,
          message: pendingMessage.message,
          timestamp: pendingMessage.timestamp
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
    console.error('[POLL] Erro no polling:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro interno do servidor' })
    };
  }
};

// Função para adicionar mensagem pendente (será chamada pelo chat.js)
function addPendingMessage(sessionId, message) {
  pendingMessages.set(sessionId, {
    message: message,
    timestamp: new Date()
  });
  console.log(`[POLL] Mensagem adicionada para ${sessionId}`);
}

// Exportar para uso em outros arquivos
if (typeof module !== 'undefined' && module.exports) {
  module.exports.addPendingMessage = addPendingMessage;
}
