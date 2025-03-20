import crypto from 'crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CoupangSignatureService {
  private readonly secretKey: string;
  private readonly accessKey: string;
  private readonly vendorId: string;

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('COUPANG_SECRET_KEY')!;
    this.accessKey = this.configService.get<string>('COUPANG_ACCESS_KEY')!;
    this.vendorId = this.configService.get<string>('COUPANG_VENDOR_ID')!;
  }

  async createHmacSignature(
    method: string,
    path: string,
    nextToken: string = '',
    useQuery: boolean = true,
  ) {
    const datetime =
      new Date().toISOString().substr(2, 17).replace(/:/gi, '').replace(/-/gi, '') + 'Z';

    const query = useQuery
      ? new URLSearchParams({
          vendorId: this.vendorId,
          nextToken,
          maxPerPage: '100',
          status: 'APPROVED',
        }).toString()
      : '';

    const message = datetime + method + path + query;

    const signature = crypto.createHmac('sha256', this.secretKey).update(message).digest('hex');

    const authorization = `CEA algorithm=HmacSHA256, access-key=${this.accessKey}, signed-date=${datetime}, signature=${signature}`;

    return { authorization, datetime };
  }

  async createParamHmacSignature(method: string, path: string, params: Record<string, any>) {
    const datetime =
      new Date().toISOString().slice(2, 19).replace(/:/gi, '').replace(/-/gi, '') + 'Z';

    const query = new URLSearchParams(params).toString(); // params로 queryString 생성

    const message = datetime + method + path + query;

    const signature = crypto.createHmac('sha256', this.secretKey).update(message).digest('hex');

    const authorization = `CEA algorithm=HmacSHA256, access-key=${this.accessKey}, signed-date=${datetime}, signature=${signature}`;

    return { authorization, datetime };
  }
}
