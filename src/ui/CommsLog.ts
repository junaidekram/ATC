/**
 * CommsLog
 * Manages the communications log display
 */
export class CommsLog {
  private logElement: HTMLElement;
  private messages: Array<{ type: string; text: string; timestamp: Date }> = [];

  constructor(elementId: string) {
    const element = document.getElementById(elementId);
    if (!element) {
      throw new Error(`Element with ID "${elementId}" not found`);
    }
    this.logElement = element;
  }

  /**
   * Add a player message to the log
   */
  addPlayerMessage(text: string): void {
    this.addMessage('player', text);
  }

  /**
   * Add an aircraft message to the log
   */
  addAircraftMessage(text: string): void {
    this.addMessage('aircraft', text);
  }

  /**
   * Add a system message to the log
   */
  addSystemMessage(text: string): void {
    this.addMessage('system', text);
  }

  /**
   * Add an error message to the log
   */
  addErrorMessage(text: string): void {
    this.addMessage('error', text);
  }

  /**
   * Add a message to the log
   */
  private addMessage(type: string, text: string): void {
    const timestamp = new Date();
    this.messages.push({ type, text, timestamp });

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = `[${this.formatTime(timestamp)}] ${text}`;

    this.logElement.appendChild(messageDiv);

    // Auto-scroll to bottom
    this.logElement.scrollTop = this.logElement.scrollHeight;

    // Limit to last 100 messages
    if (this.messages.length > 100) {
      this.messages.shift();
      this.logElement.removeChild(this.logElement.firstChild!);
    }
  }

  /**
   * Format time for display
   */
  private formatTime(date: Date): string {
    return date.toTimeString().split(' ')[0];
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages = [];
    this.logElement.innerHTML = '';
  }
}
