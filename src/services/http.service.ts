export class HttpService {
    private baseUrl: string;
    private headers: Headers;

    constructor(baseUrl: string, headers?: Headers) {
        this.baseUrl = baseUrl;
        this.headers = headers || new Headers();
    }

    async get(path: string, headers: Headers) {
        let response;

        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                headers,
            });
            if (response.ok) {
                return {
                    success: response.ok,
                    status: response.status,
                    ...(await response.json()),
                };
            } else {
                const res = await response.json();
                return {
                    success: response.ok,
                    status: response.status,
                    ...res,
                };
            }
        } catch (err: any) {
            console.error(err?.message);
            throw new Error("GET response could not be parsed.", { cause: response });
        }
    }

    async post(path: string, headers: Headers, body: string) {
        let response;
        try {
            response = await fetch(`${this.baseUrl}${path}`, {
                method: "POST",
                headers,
                body: body,
            });
            if (response.ok) {
                return {
                    success: response.ok,
                    status: response.status,
                    ...(await response.json()),
                };
            } else {
                const res = await response.json();
                return {
                    success: response.ok,
                    status: response.status,
                    ...res,
                };
            }
        } catch (err: any) {
            console.error(err?.message);
            throw new Error("POST response could not be parsed.", { cause: response });
        }
    }
}
