const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

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
    const { location, foodType, city } = JSON.parse(event.body || '{}');
    
    // Usar Gemini para buscar restaurantes
    const searchPrompt = `
    Você é um especialista em restaurantes e delivery. Preciso que você me forneça informações sobre os melhores restaurantes de ${foodType} na cidade de ${city}, região ${location}.

    Para cada restaurante, forneça:
    1. Nome do restaurante
    2. Número de WhatsApp (formato: 5524999999999)
    3. Endereço completo
    4. Avaliação (de 1 a 5)
    5. Tempo estimado de entrega
    6. Faixa de preço estimada

    Forneça 3 opções dos melhores restaurantes, priorizando qualidade e tempo de entrega.
    
    Responda APENAS em formato JSON válido, exemplo:
    [
      {
        "name": "Pizzaria Dom José",
        "phone": "5524999999999",
        "address": "Rua das Pizzas, 123, Centro",
        "rating": 4.5,
        "estimatedTime": "40-50 min",
        "estimatedPrice": "R$ 35-45",
        "specialty": "Pizza tradicional"
      }
    ]
    `;

    try {
      const result = await model.generateContent(searchPrompt);
      const response = result.response.text();
      
      // Tentar parsear a resposta como JSON
      let restaurants;
      try {
        restaurants = JSON.parse(response);
      } catch (parseError) {
        // Se não conseguir parsear, usar dados mock
        restaurants = getMockRestaurants(foodType, city);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          restaurants: restaurants
        })
      };

    } catch (geminiError) {
      console.error('Erro no Gemini:', geminiError);
      
      // Fallback para dados mock
      const restaurants = getMockRestaurants(foodType, city);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          restaurants: restaurants
        })
      };
    }

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

// Função para dados mock como fallback
function getMockRestaurants(foodType, city) {
  const baseRestaurants = {
    pizza: [
      {
        name: 'Pizzaria Dom José',
        phone: '5524999999999',
        address: 'Rua das Pizzas, 123, Centro',
        rating: 4.5,
        estimatedTime: '40-50 min',
        estimatedPrice: 'R$ 35-45',
        specialty: 'Pizza tradicional'
      },
      {
        name: 'Pizza Express',
        phone: '5524888888888',
        address: 'Av. dos Sabores, 456, Centro',
        rating: 4.2,
        estimatedTime: '35-45 min',
        estimatedPrice: 'R$ 30-40',
        specialty: 'Pizza gourmet'
      },
      {
        name: 'Bella Napoli',
        phone: '5524777777777',
        address: 'Rua Italiana, 789, Centro',
        rating: 4.7,
        estimatedTime: '45-55 min',
        estimatedPrice: 'R$ 40-50',
        specialty: 'Pizza artesanal'
      }
    ],
    hamburguer: [
      {
        name: 'Burger House',
        phone: '5524666666666',
        address: 'Av. dos Lanches, 321, Centro',
        rating: 4.3,
        estimatedTime: '30-40 min',
        estimatedPrice: 'R$ 25-35',
        specialty: 'Hambúrguer artesanal'
      },
      {
        name: 'Mega Burger',
        phone: '5524555555555',
        address: 'Rua do Sabor, 654, Centro',
        rating: 4.1,
        estimatedTime: '35-45 min',
        estimatedPrice: 'R$ 20-30',
        specialty: 'Hambúrguer tradicional'
      }
    ]
  };

  // Determinar tipo de comida
  let type = 'pizza'; // default
  if (foodType.toLowerCase().includes('hamburguer') || foodType.toLowerCase().includes('lanche')) {
    type = 'hamburguer';
  }

  return baseRestaurants[type] || baseRestaurants.pizza;
}
