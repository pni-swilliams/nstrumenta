import {
  AnswerWebRTC,
  CandidateWebRTC,
  ClientStatus,
  ConnectOptions,
  Connection,
  JoinWebRTC,
  NstrumentaClientBase,
  StorageService,
  WebSocketLike,
  getEndpoints,
  getToken,
} from '../shared';
import { deserializeWireMessage } from '../shared/lib/busMessage';
import { WebrtcClient } from './video/src';

export const endpoints = getEndpoints('prod');

export { Kind, MediaInfo, SubscriberType } from './video/src';
export class NstrumentaBrowserClient extends NstrumentaClientBase {
  public webrtcClient: WebrtcClient | null = null;

  constructor(apiKey?: string) {
    super();
    if (apiKey) {
      this.apiKey = apiKey;
      localStorage.setItem('apiKey', apiKey);
    }
    // initiate the storage service for file upload/download
    this.storage = new StorageService({ apiKey: apiKey ? apiKey : this.apiKey });
    this.webrtcClient = new WebrtcClient();
  }

  public async connect(connectOptions?: ConnectOptions): Promise<Connection> {
    return new Promise(async (resolve, reject) => {
      const {
        wsUrl: wsUrlOption = undefined,
        apiKey: apiKeyOption = undefined,
        verify = true,
      } = connectOptions ? connectOptions : {};

      const { search } = window.location;
      const wsUrlParam = new URLSearchParams(search).get('wsUrl');
      const wsUrl = wsUrlOption
        ? wsUrlOption
        : wsUrlParam
        ? wsUrlParam
        : window.location.origin.replace('http', 'ws');

      const apiKeyParam = new URLSearchParams(search).get('apiKey');
      const apiLocalStore = localStorage.getItem('apiKey');
      const apiKey = apiKeyOption
        ? apiKeyOption
        : apiKeyParam
        ? apiKeyParam
        : apiLocalStore
        ? apiLocalStore
        : prompt('Enter your nstrumenta apiKey');
      if (apiKey) {
        localStorage.setItem('apiKey', apiKey);
      }

      if (this.reconnection.attempts > 100) {
        throw new Error('Too many reconnection attempts, stopping');
      }

      if (!apiKey) {
        throw new Error(
          'nstrumenta api key is missing, pass it as an argument to NstrumentaClient.connect({apiKey: "your key"}) for javascript clients in the browser, or set the NSTRUMENTA_API_KEY environment variable get a key from your nstrumenta project settings https://nstrumenta.com/projects/ *your projectId here* /settings'
        );
      }

      this.apiKey = apiKey;
      let token = 'unverified';
      if (verify) {
        try {
          token = await getToken(this.apiKey);
        } catch (error) {
          console.error((error as Error).message);
          throw error;
        }
      }
      this.ws = new WebSocket(wsUrl) as unknown as WebSocketLike;
      this.ws.binaryType = 'arraybuffer';
      this.ws.addEventListener('open', async () => {
        console.log(`client websocket opened <${wsUrl}>`);
        this.ws?.send(token);
        this.reconnection.attempts = 0;
        this.connection.status = ClientStatus.CONNECTING;
      });
      this.ws.addEventListener('close', (status) => {
        this.connection.status = ClientStatus.DISCONNECTED;
        this.listeners.get('close')?.forEach((callback) => callback());
        console.log(
          `client websocket closed ${wsUrl} code:${status.code} wasClean:${status.wasClean}`
        );
        this.subscriptions.clear();
        // reconnect on close
        if (this.reconnection.hasVerified) {
          this.reconnection.timeout = setTimeout(() => {
            this.reconnection.timeout = null;
            console.log(`attempting to reconnect, attempts: ${this.reconnection.attempts}`);
            this.connect(connectOptions);
          }, this.rollOff(this.reconnection.attempts));
          this.reconnection.attempts += 1;
        }
      });
      this.ws.addEventListener('error', (event) => {
        this.connection.status = ClientStatus.ERROR;
        reject(`Error in websocket connection: ${event.message}`);
      });
      this.ws.addEventListener('message', (event) => {
        const wireMessage = event.data as ArrayBuffer;
        //console.log('nstClient received message', wireMessage);
        let deserializedMessage;
        try {
          deserializedMessage = deserializeWireMessage(wireMessage as ArrayBuffer);
        } catch (error) {
          console.log(`Couldn't deserialize message ${JSON.stringify(error)}`);
          return;
        }
        const { channel, contents } = deserializedMessage;
        if (channel == '_nstrumenta') {
          const { verified, error, clientId } = contents;
          if (error) {
            console.error(error);
          }
          if (verified) {
            this.connection.status = ClientStatus.CONNECTED;
            this.reconnection.hasVerified = true;
            this.listeners.get('open')?.forEach((callback) => callback());
            this.messageBuffer.forEach((message) => {
              this.ws?.send(message);
            });
            this.messageBuffer = [];
            this.clientId = clientId;
            resolve(this.connection);
          }
        }
        if (channel == '__event') {
          const { event } = contents;
          this.listeners.get(event)?.forEach((callback) => callback());
        }

        this.subscriptions.get(channel)?.forEach((subscription) => {
          subscription(contents);
        });
      });
    });
  }

  public joinWebRTC = async (
    room: string
  ): Promise<{ peerId: string; offer: RTCSessionDescription }> => {
    console.log('browserClient joinWebRTC');
    return this.callRPC<JoinWebRTC>('joinWebRTC', { room });
  };

  public candidateWebRTC = async (
    peerId: string,
    room: string,
    candidate: RTCIceCandidate
  ): Promise<undefined> => {
    return this.callRPC<CandidateWebRTC>('candidateWebRTC', {
      peerId,
      room,
      candidate,
    }) as Promise<undefined>;
  };

  public answerWebRTC = async (
    peerId: string,
    room: string,
    answer: RTCSessionDescription
  ): Promise<undefined> => {
    return this.callRPC<AnswerWebRTC>('answerWebRTC', {
      peerId,
      room,
      answer,
    }) as Promise<undefined>;
  };
}
