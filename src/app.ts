import express from 'express';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found-handler';
import { restaurantRouter } from './modules/restaurants/restaurant.routes';

export const app = express();

app.use(express.json());
app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});
app.use('/v1/restaurants', restaurantRouter);
app.use(notFoundHandler);
app.use(errorHandler);
