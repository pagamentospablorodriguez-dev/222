// Função para buscar restaurantes (placeholder para Google Places API)
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
    const { location, query } = JSON.parse(event.body || '{}');
    
    // Mock data - em produção, usar Google Places API
    const mockRestaurants = [
      {
        id: '1',
        name: 'Pizzaria Dom José',
        phone: '5524999999999',
        address: 'Rua das Pizzas, 123',
        rating: 4.5,
        specialty: 'Pizza tradicional',
        estimatedTime: '40-50 min',
        whatsapp: '5524999999999'
      },
      {
        id: '2',
        name: 'Pizza Express',
        phone: '5524888888888',
        address: 'Av. dos Sabores, 456',
        rating: 4.2,
        specialty: 'Pizza gourmet',
        estimatedTime: '35-45 min',
        whatsapp: '5524888888888'
      }
    ];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        restaurants: mockRestaurants
      })
    };

  } catch (error) {
    console.error('Erro na busca de restaurantes:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};