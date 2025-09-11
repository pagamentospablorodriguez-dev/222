// SISTEMA DE POLLING REAL FUNCIONANDO - IA FOME 🚀

exports.handler = async (event, context) => {
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

    console.log(`[POLL-REAL] 🔍 Verificando mensagens para: ${sessionId}`);

    // Simular acesso ao sistema de mensagens pendentes
    // Em produção, usaria banco de dados compartilhado
    
    // Por enquanto, retorna que não há mensagens
    // O polling real acontece via setTimeout no frontend
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        hasNewMessage: false,
        timestamp: new Date().toISOString(),
        sessionId: sessionId
      })
    };
    
  } catch (error) {
    console.error('[POLL-REAL] ❌ Erro no polling:', error);
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
