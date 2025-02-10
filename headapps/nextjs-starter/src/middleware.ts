import { NextResponse, NextRequest, NextFetchEvent } from 'next/server';
import middleware from 'lib/middleware';

// Caching the Sitecore API response
let countriesCache: Map<string, string> | null = null;

async function getCountriesFromSitecore(): Promise<Map<string, string>> {
  const query = `
  {
    item(language: "en", path: "{91CEB4EA-3EB0-4C5D-A25D-3E6801C46A9F}") {
      field(name: "CountryMapping") {
        jsonValue
      }
    }
  }
  `;

  const response = await fetch('https://edge.sitecorecloud.io/api/graphql/v1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GQL-TOKEN': 'R25xM01mYmZiVzBac0Q1ZG5qcnNiQWFzb2h5L2xlMzNlcDA1WEV4OTgyOD18aG9yaXpvbnRhbGRkZGY2LXRyYWluaW5nMDgyYjAwOS1kZXY1NDE0LWM4MzE='
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error('Failed to fetch countries from Sitecore');
  }

  const data = await response.json();
  const countriesString: string = data?.data?.item?.field?.jsonValue?.value;

  if (!countriesString) {
    throw new Error('Invalid or missing country data from Sitecore');
  }

  const parsedCountries = new Map<string, string>(
    countriesString.split('&').map((pair: string): [string, string] => {
      const [country, path] = pair.split('=');
      if (!country || !path) {
        throw new Error('Invalid country-path pair');
      }
      return [country, decodeURIComponent(path)];
    })
  );

  countriesCache = parsedCountries;
  return countriesCache;
}

export default async function middlewareHandler(req: NextRequest, ev: NextFetchEvent) {
  let response = NextResponse.next();
  let rewrittenUrl: URL | null = null;

  // Check if the 'middleware-rewrite' cookie exists and delete it
  if (req.cookies.has('middleware-rewrite')) {
    response.cookies.delete('middleware-rewrite');
  }

  // Only run country check on the home page and if the rewrite hasn't happened yet
  if (req.nextUrl.pathname === '/') {
    try {
      // Get the country from the request (replace this with actual country detection logic)
      const country = req?.geo?.country || 'Denmark';

      if (country) {
        // Fetch countries from Sitecore (cached)
        const countries = await getCountriesFromSitecore();

        // Check if the request country matches any country from Sitecore
        if (countries.has(country)) {
          rewrittenUrl = req.nextUrl.clone();
          const countryPath = countries.get(country);

          if (countryPath && countryPath !== '/') {
            rewrittenUrl.pathname = `/countryhome${countryPath}`;
          }

          // Pass the original URL as a query parameter
          rewrittenUrl.searchParams.set('originalPath', req.nextUrl.pathname);
          response = NextResponse.rewrite(rewrittenUrl);

          response.cookies.set('middleware-rewrite', 'true', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'test',
            maxAge: 60 * 5, // 5 minutes
            path: '/'
          });
        }
      }
    } catch (error) {
      console.error('Error in country check middleware:', error);
      // Continue with the original request in case of error
    }
  }

  const newReq = rewrittenUrl ? new NextRequest(rewrittenUrl, req) : req;
  // Execute the original middleware with the potentially modified response
  return middleware(newReq, ev, response);
}

export const config = {
  matcher: [
    '/', // Explicitly match the home page
    '/home2',
    '/home3',
    // Match other paths, excluding the ones specified
    '/((?!api/|_next/|feaas-render|healthz|sitecore/api/|-/|favicon.ico|sc_logo.svg).*)'
  ]
};
