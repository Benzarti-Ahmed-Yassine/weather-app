const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const apiKey = '30d38983f879d1c3915afa9abb4c2448'; // Remplacez par une clé API valide
let weatherSettings = {
  time: '23:36',
  date: '2025-05-05',
  city: 'Paris',
  country: 'FR',
  brightness: 50,
  temperature: 'N/A',
  humidity: 'N/A'
};

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.send(JSON.stringify({ type: 'settings', data: weatherSettings }));

  ws.on('message', async (message) => {
    const fetch = (await import('node-fetch')).default; // Importation dynamique
    const { type, data } = JSON.parse(message);
    if (type === 'update') {
      weatherSettings = { ...weatherSettings, ...data };
      try {
        const { city, country, date, time } = weatherSettings;
        const currentDate = new Date();
        const inputDate = new Date(`${date}T${time}`);
        const isPast = inputDate < currentDate;
        const isFuture = inputDate > currentDate;

        let geoUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${city}`;
        if (country) geoUrl += `,${country}`;
        geoUrl += `&limit=1&appid=${apiKey}`;

        const geoResponse = await fetch(geoUrl);
        if (!geoResponse.ok) {
          const errorData = await geoResponse.json();
          throw new Error(`Geo API error: ${errorData.message}`);
        }
        const geoData = await geoResponse.json();
        if (!geoData.length) throw new Error('Location not found');

        const { lat, lon } = geoData[0];
        let weatherUrl;
        if (isPast) {
          const timestamp = Math.floor(inputDate.getTime() / 1000);
          const fiveDaysAgo = Math.floor((Date.now() - 5 * 24 * 60 * 60 * 1000) / 1000);
          if (timestamp < fiveDaysAgo) {
            throw new Error('Historical data only available for the last 5 days');
          }
          weatherUrl = `http://api.openweathermap.org/data/2.5/onecall/timemachine?lat=${lat}&lon=${lon}&dt=${timestamp}&appid=${apiKey}&units=metric`;
        } else if (isFuture) {
          weatherUrl = `http://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
        } else {
          weatherUrl = `http://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
        }

        const weatherResponse = await fetch(weatherUrl);
        if (!weatherResponse.ok) {
          const errorData = await weatherResponse.json();
          if (weatherResponse.status === 401) {
            throw new Error('Invalid API key. Please check your OpenWeatherMap API key or contact support.');
          }
          throw new Error(`Weather API error: ${errorData.message}`);
        }
        const weatherData = await weatherResponse.json();

        let temp, hum;
        if (isPast) {
          if (!weatherData.current || weatherData.current.temp === undefined) {
            throw new Error('Invalid data structure for past weather');
          }
          temp = weatherData.current.temp;
          hum = weatherData.current.humidity;
        } else if (isFuture) {
          if (!weatherData.list || !weatherData.list.length) {
            throw new Error('No forecast data available');
          }
          const closestForecast = weatherData.list.reduce((prev, curr) => {
            const currTime = new Date(curr.dt * 1000);
            const prevTime = new Date(prev.dt * 1000);
            return Math.abs(currTime - inputDate) < Math.abs(prevTime - inputDate) ? curr : prev;
          });
          temp = closestForecast.main.temp;
          hum = closestForecast.main.humidity;
        } else {
          if (!weatherData.main || weatherData.main.temp === undefined) {
            throw new Error('Invalid data structure for current weather');
          }
          temp = weatherData.main.temp;
          hum = weatherData.main.humidity;
        }

        weatherSettings.temperature = `${Math.round(temp)}°C`;
        weatherSettings.humidity = `${Math.round(hum)}%`;
      } catch (error) {
        console.error('Weather API error:', error);
        weatherSettings.temperature = `${Math.floor(Math.random() * 30)}°C`;
        weatherSettings.humidity = `${Math.floor(Math.random() * 100)}%`;
        ws.send(JSON.stringify({ type: 'error', message: `Failed to fetch weather data: ${error.message}. Using mock data.` }));
      }
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'settings', data: weatherSettings }));
        }
      });
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

app.use(express.static('public'));

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});