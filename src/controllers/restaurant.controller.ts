import type { Request, Response } from 'express';
import { toRestaurantDetail } from '../mappers/restaurant.mapper';
import type { RestaurantService } from '../models/restaurant.model';
import { ApplicationError } from '../utils/application-error';
import { parseRequest, withoutBlankValues } from '../validators/parse-request';
import {
  createRestaurantBodySchema,
  listRestaurantsQuerySchema,
  restaurantIdSchema,
  searchRestaurantsQuerySchema,
} from '../validators/restaurant.schema';

export const RESTAURANTS_PATH = '/v1/restaurants';

/**
 * HTTP edge of the restaurant endpoints: validate the request, call the
 * service, shape the response (status, headers, API body). No business rules
 * and no MongoDB here (AGENTS.md §5).
 */
export class RestaurantController {
  constructor(private readonly service: RestaurantService) {}

  // A ZodError from parseRequest() reaches the error handler, which answers 400
  // VALIDATION_ERROR with field details. Arrow properties keep `this` bound.
  create = async (request: Request, response: Response): Promise<void> => {
    const body = parseRequest(createRestaurantBodySchema, request.body);
    const restaurant = toRestaurantDetail(await this.service.create(body));
    response
      .status(201)
      .location(`${RESTAURANTS_PATH}/${restaurant.id}`)
      .json(restaurant);
  };

  getById = async (
    request: Request<{ id: string }>,
    response: Response,
  ): Promise<void> => {
    // Checked at the edge, so the service is never called with a malformed
    // id (the repository's ObjectId.createFromHexString would throw on one).
    const id = restaurantIdSchema.safeParse(request.params.id);
    if (!id.success) {
      throw new ApplicationError(
        'INVALID_ID',
        'Restaurant id must be a 24-character hex string',
      );
    }
    const restaurant = await this.service.getById(id.data);
    response.status(200).json(toRestaurantDetail(restaurant));
  };

  list = async (request: Request, response: Response): Promise<void> => {
    const query = parseRequest(
      listRestaurantsQuerySchema,
      withoutBlankValues(request.query),
    );
    response.status(200).json(await this.service.list(query));
  };

  search = async (request: Request, response: Response): Promise<void> => {
    const query = parseRequest(
      searchRestaurantsQuerySchema,
      withoutBlankValues(request.query),
    );
    response.status(200).json(await this.service.search(query));
  };
}
