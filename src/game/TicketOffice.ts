import { STADIUM } from '../core/Config';
import sellerData from '../data/seller.json';

/** Кассса стадиона (задача 18): что спрашивают у кассира и что он отвечает.
 *
 *  Здесь только правила, без DOM и three.js — поэтому логику можно проверить
 *  офлайн-тестом (`npm run check:seller`), не поднимая браузер.
 *
 *  Расписание выводится из состояния игры, а не из «рандома»:
 *   - пока матч не играли (счёт 0:0) — «уже через час начнётся, ты принят»;
 *   - после игры — «завтра будет футбольная игра, если хочешь, приходи».
 *  Одни и те же правила задают и то, чей матч можно посмотреть, поэтому
 *  ответы кассира не противоречат друг другу. */

/** Где стоит кассир: у правого окна кассы, лицом к площади (+Z).
 *  Держим здесь, а не в three-модуле, чтобы правило проверялось офлайн-тестом. */
export const SELLER_SPOT = {
  x: STADIUM.centerX + STADIUM.width / 2 + STADIUM.plazaWidth / 2 + 1.8,
  z: STADIUM.centerZ - STADIUM.plazaDepth / 2 + 0.5 + 0.95,
  /** Группа смотрит в −Z, значит «лицом на площадь» — это разворот на π. */
  yaw: Math.PI,
} as const;

export interface SellerLine {
  readonly id: string;
  readonly text: string;
  readonly file: string;
}

export interface SellerQuestion {
  readonly id: string;
  readonly label: string;
}

export const SELLER_SPEAKER: string = sellerData.speaker;
export const SELLER_LINES: readonly SellerLine[] = sellerData.lines as readonly SellerLine[];
export const SELLER_QUESTIONS: readonly SellerQuestion[] = sellerData.questions as readonly SellerQuestion[];

/** Команды острова: первая — команда героя (в ней пока нет игроков). */
export const TEAMS = ['Viced Boys', 'Морские волки', 'Коралловые короли', 'Пиратская бухта', 'Чайки'] as const;

export interface OfficeContext {
  /** Матч уже играли (на табло не 0:0) — значит следующий будет завтра. */
  readonly played: boolean;
  /** Билет уже в кармане. */
  readonly hasTicket: boolean;
}

export const lineById = (id: string): SellerLine | undefined =>
  SELLER_LINES.find((line) => line.id === id);

export class TicketOffice {
  /** Герой подал заявку в Viced Boys. */
  private registered = false;
  /** Сколько билетов продано за сессию. */
  private tickets = 0;

  get isRegistered(): boolean {
    return this.registered;
  }

  get ticketsSold(): number {
    return this.tickets;
  }

  /** Реплика кассира в ответ на вопрос. null — ответа нет (например, билет уже куплен). */
  answer(questionId: string, context: OfficeContext): string | null {
    switch (questionId) {
      case 'join':
        // Заявка одна: после неё кассир называет сроки, но не «принимает» дважды.
        this.registered = true;
        return context.played ? 'join_tomorrow' : 'join_soon';
      case 'watch':
        return context.played ? 'watch_tomorrow' : 'watch_today';
      case 'teams':
        return 'teams';
      case 'viced':
        return 'viced';
      case 'ticket':
        if (context.hasTicket) return null;
        this.tickets += 1;
        return 'ticket_sold';
      case 'bye':
        return 'bye';
      default:
        return null;
    }
  }

  /** Приветствие при подходе к кассе — одно и то же каждый раз. */
  greeting(): string {
    return 'greet';
  }

  /** Пары, которые кассир называет вслух: сегодняшняя и завтрашняя. */
  static pairing(played: boolean): readonly [string, string] {
    return played ? [TEAMS[3], TEAMS[4]] : [TEAMS[1], TEAMS[2]];
  }

  reset(): void {
    this.registered = false;
    this.tickets = 0;
  }
}
