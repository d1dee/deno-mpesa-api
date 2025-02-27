import {
    AccountBalanceInterface,
    AccountBalanceResponseInterface,
    B2BInterface,
    B2CInterface,
    B2CResponseInterface,
    C2BRegisterInterface,
    C2BRegisterResponseInterface,
    CredentialsInterface,
    ReversalInterface,
    ReversalResponseInterface,
    StkPushInterface,
    StkPushResponse,
    StkQueryInterface,
    StkQueryResponseInterface,
    T_AuthResponse,
    TransactionStatusInterface,
    TransactionStatusResponseInterface,
} from "../@types/types.d.ts";

import { resolve } from "jsr:@std/path";
import { Buffer } from "node:buffer";
import { RSA_PKCS1_PADDING } from "node:constants";
import { publicEncrypt } from "node:crypto";
import { join } from "node:path";
import { routes } from "./routes.ts";
import { HttpService } from "./services/http.service.ts";

const { paths } = routes;

export class MpesaApi {
    clientKey: string;
    clientSecret: string;
    baseUrl: string;
    http: HttpService;
    environment: string;
    securityCredential?: string;

    constructor({
        clientKey,
        clientSecret,
        securityCredential,
        initiatorPassword,
    }: CredentialsInterface, environment: "production" | "sandbox") {
        this.clientKey = clientKey;
        this.clientSecret = clientSecret;
        this.environment = environment;
        this.baseUrl = environment === "production" ? routes.production : routes.sandbox;

        if (!clientKey || !clientSecret) {
            throw new Error(
                "clientKey and clientSecret can never be undefined ",
            );
        }
        this.http = new HttpService(this.baseUrl);

        if (!securityCredential && !initiatorPassword && environment === "production") {
            console.warn(
                new Error(
                    "You must provide either the security credential or initiator password. Both cannot be null",
                ),
            );
        }
        this.generateSecurityCredential;
    }

    private generateSecurityCredential(
        password: string,
        certificatePath?: string,
    ) {
        let certificate: string;
        const decoder = new TextDecoder();

        if (certificatePath != null) {
            const certificateBuffer = Deno.readFileSync(certificatePath);

            certificate = decoder.decode(certificateBuffer);
        } else {
            const certificateBuffer = Deno.readFileSync(
                resolve(
                    Deno.cwd(),
                    this.environment === "production"
                        ? join("src", "keys", "production-cert.cer")
                        : join("src", "keys", "sandbox-cert.cer"),
                ),
            );

            certificate = decoder.decode(certificateBuffer);
        }

        this.securityCredential = publicEncrypt(
            {
                key: certificate,
                padding: RSA_PKCS1_PADDING,
            },
            Buffer.from(password),
        ).toString("base64");
        return this.securityCredential;
    }

    // https://developer.safaricom.co.ke/APIs/Authorization
    async authenticate(): Promise<[T_AuthResponse, Headers]> {
        const headers = new Headers();
        headers.append(
            "Authorization",
            `Basic ${Buffer.from(this.clientKey + ":" + this.clientSecret).toString("base64")}`,
        );
        const tokenRes = await this.http.get(paths.auth, headers) as T_AuthResponse;
        if (tokenRes.errorCode) throw new Error(tokenRes.errorMessage, { cause: tokenRes });

        if (!tokenRes.access_token) {
            throw new Error("failed to get access token form server", { cause: tokenRes });
        }
        const resHeaders = new Headers();
        headers.append("Authorization", "Bearer " + tokenRes.access_token);
        headers.append("Content-Type", "application/json");

        return [tokenRes, resHeaders];
    }
    /**
     * Lipa na Mpesa Online
     * @name Lipa Na Mpesa Online
     * @description Lipa na M-Pesa Online Payment API is used to initiate a M-Pesa transaction on behalf of a customer using STK Push.
     * This is the same technique mySafaricom App uses whenever the app is used to make payments.
     * @see {@link https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate }
     */
    async lipaNaMpesaOnline({
        BusinessShortCode,
        TransactionDesc,
        TransactionType,
        PartyA,
        PartyB,
        passKey,
        Amount,
        AccountReference,
        CallBackURL,
        PhoneNumber,
    }: StkPushInterface): Promise<StkPushResponse> {
        const Timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, -3);

        const Password = Buffer.from(BusinessShortCode + passKey + Timestamp).toString("base64");

        const [, headers] = await this.authenticate();
        if (!headers) throw new Error("Auth failed");

        const body = JSON.stringify({
            "BusinessShortCode": BusinessShortCode,
            Password: Password,
            "Timestamp": Timestamp,
            "TransactionType": TransactionType,
            "Amount": Amount,
            "PartyA": PartyA,
            "PartyB": PartyB,
            "PhoneNumber": PhoneNumber,
            "CallBackURL": CallBackURL,
            "AccountReference": AccountReference,
            "TransactionDesc": TransactionDesc,
        });

        return await this.http.post(routes.paths.stkpush, headers, body);
    }

    /**
     * Lipa na Mpesa Online
     * @name StkQuery
     * @description Lipa na M-Pesa Online Query is used to check for Payment status.
     * @see https://developer.safaricom.co.ke/APIs/MpesaExpressQuery
     * @param {StkQueryInterface} data Data
     * @param {string} data.BusinessShortCode The organization shortcode used to receive the transaction.
     * @param {number} data.CheckoutRequestID Check out Request ID.
     * @param {any} data.passKey Lipa Na Mpesa Pass Key
     * @returns {Promise} Returns a Promise with data from Safaricom if successful
     */
    public async lipaNaMpesaQuery({
        BusinessShortCode,
        passKey,
        CheckoutRequestID,
    }: StkQueryInterface): Promise<StkQueryResponseInterface> {
        const Timestamp = new Date()
            .toISOString()
            .replace(/[^0-9]/g, "")
            .slice(0, -3);

        const Password = Buffer.from(
            BusinessShortCode + passKey + Timestamp,
        ).toString("base64");

        const [, headers] = await this.authenticate();

        const response = await this.http.post(
            routes.paths.stkquery,
            headers,
            JSON.stringify({
                BusinessShortCode,
                Password,
                Timestamp,
                CheckoutRequestID,
            }),
        );

        return response;
    }

    /**
     * Reversal Request
     *
     * @name ReversalRequest
     *
     * @description Transaction Reversal API reverses a M-Pesa transaction.
     * @see {@link https://developer.safaricom.co.ke/reversal/apis/post/request| Reversal Request}
     */
    public async reversal({
        Initiator,
        CommandID,
        TransactionID,
        Amount,
        ReceiverParty,
        RecieverIdentifierType,
        ResultURL,
        QueueTimeOutURL,
        Remarks,
        Occasion,
    }: ReversalInterface): Promise<ReversalResponseInterface> {
        const [, headers] = await this.authenticate();

        return await this.http.post(
            routes.paths.reversal,
            headers,
            JSON.stringify({
                Initiator,
                SecurityCredential: this.securityCredential,
                CommandID: CommandID ?? "TransactionReversal",
                TransactionID,
                Amount,
                ReceiverParty,
                RecieverIdentifierType: RecieverIdentifierType ?? "4",
                ResultURL,
                QueueTimeOutURL,
                Remarks: Remarks ?? "Transaction Reversal",
                Occasion: Occasion ?? "TransactionReversal",
            }),
        );
    }

    /**
       * C2B Register
       *
       * @name C2BRegister
       *
       * @description The C2B Register URL API registers the 3rd party’s confirmation and validation URLs to M-Pesa ;
       * which then maps these URLs to the 3rd party shortcode.
       * Whenever M-Pesa receives a transaction on the shortcode,
       * M-Pesa triggers a validation request against the validation URL and the 3rd party system
       * responds to M-Pesa with a validation response (either a success or an error code). The response expected is the success code the 3rd party.
       *
       M-Pesa completes or cancels the transaction depending on the validation response it
       receives from the 3rd party system. A confirmation request of the transaction is then sent
        by M-Pesa through the confirmation URL back to the 3rd party which then should respond with a success acknowledging the confirmation.
       *
       The 3rd party resource URLs for both confirmation and validation must be HTTPS in production.
       Validation is an optional feature that needs to be activated on M-Pesa, the owner of the shortcode
       needs to make this request for activation.
       * @see https://developer.safaricom.co.ke/APIs/CustomerToBusinessRegisterURL
       * @param {C2BRegisterInterface} data Data
       * @param  {string} data.ValidationURLValidation URL for the client.
       * @param  {string} data.ConfirmationURL Confirmation URL for the client.
       * @param  {string} data.ResponseType Default response type for timeout. Can either be `Completed` or `Cancelled`
       * @param  {string} data.ShortCode The short code of the organization.
       * @returns {Promise} Returns a Promise with data from Safaricom if successful Returns
       */
    public async c2bRegister({
        ShortCode,
        ResponseType,
        ConfirmationURL,
        ValidationURL,
    }: C2BRegisterInterface): Promise<C2BRegisterResponseInterface> {
        const [, headers] = await this.authenticate();

        const data = await this.http.post(
            routes.paths.c2bregister,
            headers,
            JSON.stringify({ ShortCode, ResponseType, ConfirmationURL, ValidationURL }),
        );

        return data;
    }

    /**
     * Account Balance
     *
     * @name AccountBalance
     *
     * @description The Account Balance API requests for the account balance of a shortcode.
     * @see  https://developer.safaricom.co.ke/APIs/AccountBalance
     * @param {AccountBalanceInterface} data Data
     * @param {string} data.Initiator This is the credential/username used to authenticate the transaction request.
     * @param {string} data.SecurityCredential Base64 encoded string of the Security Credential, which is encrypted using M-Pesa public key and validates the transaction on M-Pesa Core system.
     * @param {string} data.CommandID A unique command passed to the M-Pesa system.
     * @param {string} data.PartyA The shortcode of the organisation initiating the transaction.
     * @param {string} data.IdentifierType Type of the organisation receiving the transaction.
     * @param {string} data.Remarks Comments that are sent along with the transaction.
     * @param {string} data.QueueTimeOutURL The timeout end-point that receives a timeout message.
     * @param {string} data.ResultURL The end-point that receives a successful transaction.
     * @returns {Promise} Returns a Promise with data from Safaricom if successful
     */
    public async accountBalance({
        Initiator,
        CommandID,
        PartyA,
        IdentifierType,
        Remarks,
        QueueTimeOutURL,
        ResultURL,
    }: AccountBalanceInterface): Promise<AccountBalanceResponseInterface> {
        const [, headers] = await this.authenticate();

        const data = await this.http.post(
            routes.paths.accountbalance,
            headers,
            JSON.stringify({
                Initiator,
                SecurityCredential: this.securityCredential,
                CommandID: CommandID ?? "AccountBalance",
                PartyA,
                IdentifierType: IdentifierType ?? "4",
                Remarks: Remarks ?? "Account Balance",
                QueueTimeOutURL,
                ResultURL,
            }),
        );

        return data;
    }

    /**
     * Transaction Status
     *
     * @name Transaction Status
     *
     * @description Transaction Status API checks the status of a B2B, B2C and C2B APIs transactions.
     * @see    https://developer.safaricom.co.ke/APIs/TransactionStatus
     * @param  {TransactionStatusInterface} data Data
     * @param  {string} data.Initiator  The name of Initiator to initiating the request.
     * @param  {string} data.SecurityCredential Encrypted Credential of user getting transaction status.
     * @param  {string} data.CommandID only 'TransactionStatusQuery' command id.
     * @param  {string} data.TransactionID Unique identifier to identify a transaction on M-Pesa.
     * @param  {string} data.PartyA Organization’s shortcode initiating the transaction.
     * @param  {any|number} data.IdentifierType - Type of organization receiving the transaction
     * @param  {string} data.ResultURL  The end-point that receives the response of the transaction
     * @param  {string} data.QueueTimeOutURL The timeout end-point that receives a timeout response.
     * @param  {string} data.Remarks Comments that are sent along with the transaction.
     * @param  {string} data.Occasion Optional
     * @returns {Promise} Returns a Promise with data from Safaricom if successful Promise
     */
    public async transactionStatus({
        Initiator,
        TransactionID,
        PartyA,
        IdentifierType,
        ResultURL,
        QueueTimeOutURL,
        Remarks,
        Occasion,
    }: TransactionStatusInterface): Promise<TransactionStatusResponseInterface> {
        const [, headers] = await this.authenticate();

        const response = await this.http.post(
            routes.paths.transactionstatus,
            headers,
            JSON.stringify(
                {
                    Initiator,
                    SecurityCredential: this.securityCredential,
                    "Command ID": "TransactionStatusQuery",
                    "Transaction ID": TransactionID,
                    PartyA,
                    IdentifierType,
                    ResultURL,
                    QueueTimeOutURL,
                    Remarks: Remarks ?? "Transaction Status",
                    Occasion: Occasion ?? "TransactionStatus",
                },
            ),
        );

        return response;
    }

    /**
     * Business to Customer(B2C)
     *
     * @name B2C
     *
     * @description This API enables Business to Customer (B2C) transactions between a company and customers who are the end-users of its products or services. Use of this API requires a valid and verified B2C M-Pesa Short code.
     * @see https://developer.safaricom.co.ke/APIs/BusinessToCustomer
     * @param {B2CInterface} data Data
     * @param  {string} data.InitiatorName This is the credential/username used to authenticate the transaction request.
     * @param  {string} data.CommandID  Unique command for each transaction type e.g. SalaryPayment, BusinessPayment, PromotionPayment.
     * @param  {number} data.Amount The amount being transacted
     * @param  {string} data.PartyA Organization’s shortcode initiating the transaction.
     * @param  {string} data.PartyB Phone number receiving the transaction
     * @param  {string} data.Remarks Comments that are sent along with the transaction.
     * @param  {string} data.QueueTimeOutURL The timeout end-point that receives a timeout response.
     * @param  {string} data.ResultURL  The end-point that receives the response of the transaction
     * @param  {string} data.Occasion Optional
     * @returns {Promise} Returns a Promise with data from Safaricom if successful
     */
    public async b2c({
        OriginatorConversationID,
        InitiatorName,
        CommandID,
        Amount,
        PartyA,
        PartyB,
        Remarks,
        QueueTimeOutURL,
        ResultURL,
        Occasion,
    }: B2CInterface): Promise<B2CResponseInterface> {
        const [, headers] = await this.authenticate();

        const response = await this.http.post(
            routes.paths.b2c,
            headers,
            JSON.stringify({
                "OriginatorConversationID": OriginatorConversationID,
                "InitiatorName": InitiatorName,
                "SecurityCredential": this.securityCredential,
                "CommandID": CommandID,
                "Amount": Amount,
                "PartyA": PartyA,
                "PartyB": PartyB,
                "Remarks": Remarks,
                "QueueTimeOutURL": QueueTimeOutURL,
                "ResultURL": ResultURL,
                "occasion": Occasion,
            }),
        );

        return response;
    }

    public async b2b(
        {
            Initiator,
            Amount,
            PartyA,
            PartyB,
            AccountReference,
            Remarks,
            QueueTimeOutURL,
            ResultURL,
        }: B2BInterface,
    ) {
        const [, headers] = await this.authenticate();

        const response = await this.http.post(
            routes.paths.b2c,
            headers,
            JSON.stringify({
                CommandID: "BusinessPayToBulk",
                Initiator: Initiator,
                SecurityCredential: this.securityCredential,
                SenderIdentifierType: 4,
                RecieverIdentifierType: 4,
                Amount: Amount,
                PartyA: PartyA,
                PartyB: PartyB,
                AccountReference: AccountReference,
                Remarks: Remarks ?? "",
                QueueTimeOutURL: QueueTimeOutURL,
                ResultURL: ResultURL,
            }),
        );

        return response;
    }
}
