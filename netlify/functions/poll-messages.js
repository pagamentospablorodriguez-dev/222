// POLLING SIMPLIFICADO - NÃO PRECISA MAIS SER COMPLEXO

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    const { sessionId } = JSON.parse(event.body);

    // Como agora fazemos tudo síncrono na mesma request,
    // não precisamos de polling complexo
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        hasNewMessage: false,
        message: 'Sistema funcionando sincronamente agora!',
        timestamp: new Date().toISOString()
      })
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erro no polling' })
    };
  }
};
