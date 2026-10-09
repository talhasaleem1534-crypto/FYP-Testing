import { Injectable, Logger } from '@nestjs/common';
// ssh2 (installed with node-ssh) has no TypeScript types; this is the one function we use.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { utils } = require('ssh2') as {
  utils: { generateKeyPairSync(type: 'ed25519', opts: { comment?: string }): { private: string; public: string } };
};
import { PersistenceService } from '../persistence/persistence.service';

interface StoredKey {
  private_key: string;
  public_key: string;
  created_at: string;
}

/**
 * The platform's own SSH key pair (like Coolify's server key). Created once and saved in the data
 * folder (platform_ssh_key.json). The customer/admin adds the PUBLIC key to the Linux server's
 * ~/.ssh/authorized_keys; the platform then logs in with the PRIVATE key, which never leaves it.
 */
@Injectable()
export class PlatformKeyService {
  private readonly logger = new Logger(PlatformKeyService.name);
  private key: StoredKey;

  constructor(private readonly store: PersistenceService) {
    const saved = this.store.load<StoredKey | null>('platform_ssh_key', null);
    if (saved?.private_key && saved?.public_key) {
      this.key = saved;
    } else {
      const pair = utils.generateKeyPairSync('ed25519', { comment: 'deploystack-platform' });
      this.key = { private_key: pair.private, public_key: pair.public, created_at: new Date().toISOString() };
      this.store.save('platform_ssh_key', this.key);
      this.logger.log('Generated the platform SSH key (ed25519).');
    }
  }

  get privateKey(): string {
    return this.key.private_key;
  }

  get publicKey(): string {
    return this.key.public_key;
  }

  /** What to show on the "Add a server" page. */
  info() {
    return {
      public_key: this.key.public_key,
      // Paste on the Linux server, logged in as the SSH user the platform will use.
      trust_command: `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${this.key.public_key}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
      prepare_commands: [
        'sudo apt update && sudo apt install -y openssh-server git curl',
        'curl -fsSL https://get.docker.com | sudo sh',
        'sudo usermod -aG docker $USER   # then log out and log in again',
        'ip -4 addr   # the server IP, e.g. 192.168.1.30',
      ],
      created_at: this.key.created_at,
    };
  }
}
