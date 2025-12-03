import type { BodyInit } from "bun";


export class ClientResponse extends Response {
  constructor(body?: BodyInit, init?: ResponseInit) {
    super(body, init);
    this.headers.set("Access-Control-Allow-Origin", "*");
    this.headers.set("Access-Control-Allow-Methods", "OPTIONS, GET, POST");
    this.headers.set("Access-Control-Allow-Headers", "Content-Type");
  }
}