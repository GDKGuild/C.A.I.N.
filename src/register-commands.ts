import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { TOKEN } from './config';
import { getCommands } from './commands';

void (async () => {
  try {
    const rest = new REST().setToken(TOKEN);
    const app = (await rest.get(Routes.oauth2CurrentApplication())) as { id: string };
    const body = getCommands().map((c) => c.builder.toJSON());
    await rest.put(Routes.applicationCommands(app.id), { body });
    console.log(`Registered ${body.length} commands for application ${app.id}`);
  } catch (e) {
    console.error('Failed to register commands:', e);
    process.exit(1);
  }
})();