// SISTEMA DE POLLING PARA MENSAGENS AUTOMÁTICAS - IA FOME 🚀

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

    // Acessar pendingMessages do chat.js (através do require)
    const chatModule = require('./chat.js');
    
    // Simular acesso ao pendingMessages (em produção usaríamos banco de dados)
    // Por enquanto, retornar que não há mensagens
    
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
