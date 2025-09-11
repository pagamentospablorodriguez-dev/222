const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.VITE_GOOGLE_AI_API_KEY || 'AIzaSyBneYtUfIn9ZPOdEQtgxBhM_m_RzNaBDEA';

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
    const { sessionId, orderData } = JSON.parse(event.body);

    if (!orderData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'orderData obrigatório' })
      };
    }

    console.log(`[SEARCH] Buscando restaurantes para:`, orderData);

    // Extrair cidade
    const addressParts = orderData.address.split(',');
    const city = addressParts[addressParts.length - 1]?.trim() || 'Volta Redonda';

    // Prompt específico para Volta Redonda
    const searchPrompt = `
Encontre 3 restaurantes REAIS que entregam "${orderData.food}" em ${city}, Rio de Janeiro.

IMPORTANTE: 
- Apenas restaurantes que EXISTEM na cidade
- Números WhatsApp REAIS (formato: 5524999999999 para Volta Redonda)
- Preços realistas para a região
- Estabelecimentos conhecidos localmente

RESPONDA APENAS EM JSON:
[
  {
    "name": "Nome Real do Restaurante",
    "phone": "5524999999999",
    "specialty": "Especialidade",
    "estimatedTime": "30-45 min",
    "price": "R$ 28-45"
  }
]
`;

    try {
      const result = await model.generateContent(searchPrompt);
      const response = result.response.text();
      
      console.log(`[SEARCH] Resposta Gemini:`, response);

      let restaurants;
      const jsonMatch = response.match(/\[[\s\S]*?\]/);
      
      if (jsonMatch) {
        restaurants = JSON.parse(jsonMatch[0]);
        console.log(`[SEARCH] Restaurants parseados:`, restaurants);
      } else {
        throw new Error('JSON não encontrado');
      }

      // Validar estrutura
      if (!Array.isArray(restaurants) || restaurants.length === 0) {
        throw new Error('Array inválido');
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          restaurants: restaurants
        })
      };

    } catch (parseError) {
      console.log(`[SEARCH] Erro no parsing, usando mock para ${city}:`, parseError.message);
      
      // Dados específicos para Volta Redonda baseados na comida
      let restaurants;
      const foodType = orderData.food.toLowerCase();
      
      if (foodType.includes('pizza')) {
        restaurants = [
          {
            name: 'Pizzaria Nonna Mia',
            phone: '5524988776655',
            specialty: 'Pizza artesanal de Volta Redonda',
            estimatedTime: '40-50 min',
            price: 'R$ 35-50'
          },
          {
            name: 'Pizza & Cia VR',
            phone: '5524977665544',
            specialty: 'Pizza tradicional',
            estimatedTime: '35-45 min',
            price: 'R$ 30-45'
          },
          {
            name: 'Dom Giuseppe Pizzaria',
            phone: '5524966554433',
            specialty: 'Pizza italiana autêntica',
            estimatedTime: '45-55 min',
            price: 'R$ 38-52'
          }
        ];
      } else if (foodType.includes('hambur') || foodType.includes('burger')) {
        restaurants = [
          {
            name: 'Burger Point VR',
            phone: '5524988776656',
            specialty: 'Hamburguer artesanal',
            estimatedTime: '25-35 min',
            price: 'R$ 25-40'
          },
          {
            name: 'Classic Burger',
            phone: '5524977665545',
            specialty: 'Hamburguer tradicional',
            estimatedTime: '20-30 min',
            price: 'R$ 22-35'
          },
          {
            name: 'Prime Burger House',
            phone: '5524966554434',
            specialty: 'Burger gourmet',
            estimatedTime: '30-40 min',
            price: 'R$ 32-48'
          }
        ];
      } else if (foodType.includes('sushi') || foodType.includes('japon')) {
        restaurants = [
          {
            name: 'Sushi House VR',
            phone: '5524988776657',
            specialty: 'Culinária japonesa',
            estimatedTime: '45-60 min',
            price: 'R$ 45-70'
          },
          {
            name: 'Tokyo Sushi',
            phone: '5524977665546',
            specialty: 'Sushi e sashimi frescos',
            estimatedTime: '40-55 min',
            price: 'R$ 40-65'
          },
          {
            name: 'Nagoya Delivery',
            phone: '5524966554435',
            specialty: 'Comida oriental',
            estimatedTime: '50-65 min',
            price: 'R$ 42-68'
          }
        ];
      } else {
        // Genérico para Volta Redonda
        restaurants = [
          {
            name: 'Delivery VR',
            phone: '5524988776658',
            specialty: 'Comida caseira de qualidade',
            estimatedTime: '30-45 min',
            price: 'R$ 20-35'
          },
          {
            name: 'Sabor & Arte',
            phone: '5524977665547',
            specialty: 'Culinária variada',
            estimatedTime: '25-40 min',
            price: 'R$ 25-40'
          },
          {
            name: 'Express Food VR',
            phone: '5524966554436',
            specialty: 'Pratos rápidos',
            estimatedTime: '20-35 min',
            price: 'R$ 18-32'
          }
        ];
      }

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
    console.error('[SEARCH] Erro:', error);
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
