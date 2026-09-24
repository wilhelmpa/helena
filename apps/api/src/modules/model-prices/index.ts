import { Elysia, t } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod, requireUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { noContent } from '#shared/http';
import { commonErrors, errors } from '#shared/responses';
import {
  ImportPricesResponse,
  ModelPriceListResponse,
  ModelPriceResponse,
  ModelPriceSettingsResponse,
  importPricesBody,
  manualPriceBody,
  modelParams,
  priceSettingsBody,
} from './model';
import {
  importModelPrices,
  listModelPrices,
  resetModelPrice,
  setManualPrice,
  setUsdToEur,
} from './service';

// The model price table: every member reads it (costs show across the app), the instance
// owner edits it in Administrator → Modellpreise.
export const modelPriceRoutes = new Elysia({
  name: 'model-prices',
  detail: { tags: ['Model prices'] },
})
  .use(authContext)
  .get(
    '/model-prices',
    ({ user }) => {
      requireUser(user);
      return listModelPrices();
    },
    {
      response: { 200: ModelPriceListResponse, ...errors(401) },
      detail: {
        summary: 'List the model prices',
        description:
          'Euros per million tokens per model, for cost estimates: from models.dev (converted at ' +
          "the owner's exchange rate) or entered by hand. Every price is an estimate.",
      },
    },
  )
  .put(
    '/god/model-prices/:model',
    ({ user, params, body }) => setManualPrice(params.model, body, requireGod(user).id),
    {
      params: modelParams,
      body: manualPriceBody,
      response: { 200: ModelPriceResponse, ...commonErrors },
      detail: {
        summary: 'Set the price of a model by hand',
        description: 'A price set by hand is never overwritten by an import from models.dev.',
      },
    },
  )
  .delete(
    '/god/model-prices/:model',
    async ({ user, params }) => {
      requireGod(user);
      if (!(await resetModelPrice(params.model)))
        throw new HttpError(404, 'No price for this model');
      return noContent();
    },
    {
      params: modelParams,
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Reset the price of a model',
        description:
          "Removes the owner's price; the models.dev price takes its place where Helena knows one.",
      },
    },
  )
  .post(
    '/god/model-prices/import',
    ({ user, body }) => {
      requireGod(user);
      return importModelPrices(body.from);
    },
    {
      body: importPricesBody,
      response: { 200: ImportPricesResponse, ...commonErrors, ...errors(502) },
      detail: {
        summary: 'Import the model prices from models.dev',
        description: 'Updates every price that was not set by hand.',
      },
    },
  )
  .put(
    '/god/model-prices/settings',
    ({ user, body }) => {
      requireGod(user);
      return setUsdToEur(body.usdToEur);
    },
    {
      body: priceSettingsBody,
      response: { 200: ModelPriceSettingsResponse, ...commonErrors },
      detail: {
        summary: 'Set the exchange rate of the model prices',
        description: 'Converts every models.dev price again at the new rate.',
      },
    },
  );
