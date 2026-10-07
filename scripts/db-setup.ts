// Создаёт таблицы и заполняет стартовые справочники: DATABASE_URL=... npm run db:setup
// (на Vercel то же самое происходит автоматически при первом обращении)
import { ensureSchema } from "../lib/db";

ensureSchema().then(() => console.log("Готово")).catch((e) => { console.error(e); process.exit(1); });
