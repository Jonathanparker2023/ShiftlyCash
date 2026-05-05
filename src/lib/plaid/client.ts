import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "plaid";

import { getPlaidServerEnv, type PlaidServerEnv } from "@/lib/env";

let plaidClient: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (!plaidClient) {
    const config = getPlaidServerEnv();
    plaidClient = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[config.env],
        baseOptions: {
          headers: {
            "PLAID-CLIENT-ID": config.clientId,
            "PLAID-SECRET": config.secret,
          },
        },
      }),
    );
  }

  return plaidClient;
}

export function toPlaidProducts(config: PlaidServerEnv): Products[] {
  return config.products.map((product) => product as Products);
}

export function toPlaidCountryCodes(config: PlaidServerEnv): CountryCode[] {
  return config.countryCodes.map((countryCode) => countryCode as CountryCode);
}
