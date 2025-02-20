import { CronJob } from "cron";

type TaskFn = (() => Promise<void>) | (() => void);

interface ScheduleConfig {
  schedule: string;
  cooldown: number; // in milliseconds
}

interface TaskSchedulerOptions {
  immediateEnvName?: string; // If this env var is set, tasks run immediately
  logger?: Console;
  backupCooldownSeconds?: number; // Backup cooldown if not specified in schedule
}

export class TaskScheduler {
  private tasks: TaskFn[] = [];
  private isRunning: boolean = false;
  private lastFinishTime: number = 0;
  private cronJob?: CronJob;
  private logger: Console;
  private scheduleConfig: ScheduleConfig;
  private immediateEnvName?: string;

  constructor(scheduleString: string = "0 5 * * * *", options: TaskSchedulerOptions = {}) {
    this.logger = options.logger || console;
    this.immediateEnvName = options.immediateEnvName;
    this.scheduleConfig = this.parseSchedule(scheduleString, options.backupCooldownSeconds);
  }

  private parseSchedule(scheduleString: string, backupCooldownSeconds: number = 0): ScheduleConfig {
    const match = scheduleString.match(/^(.*?)(?:\s*@\s*(\d+))?$/);
    if (!match) {
      return {
        schedule: scheduleString,
        cooldown: backupCooldownSeconds * 1000,
      };
    }

    const [, schedule, cooldownStr] = match;
    const cooldownSeconds = cooldownStr ? parseInt(cooldownStr, 10) : backupCooldownSeconds;

    return {
      schedule: schedule.trim(),
      cooldown: cooldownSeconds * 1000, // Convert to milliseconds
    };
  }

  register(task: TaskFn): void {
    this.tasks.push(task);
  }

  private async executeTask(task: TaskFn, index: number): Promise<void> {
    try {
      this.logger.info(`Executing task ${index + 1}/${this.tasks.length}`);
      await Promise.resolve(task());
      this.logger.info(`Task ${index + 1} completed successfully`);
    } catch (error) {
      this.logger.error(`Task ${index + 1} failed:`, error);
      // Continue with next task despite error
    }
  }

  private async executor(): Promise<void> {
    const now = Date.now();

    if (this.isRunning) {
      this.logger.info("Previous execution still running. Skipping this run.");
      return;
    }

    if (now - this.lastFinishTime < this.scheduleConfig.cooldown) {
      const remainingCooldown = Math.ceil((this.scheduleConfig.cooldown - (now - this.lastFinishTime)) / 1000);
      this.logger.info(`Cooldown period not elapsed. Skipping this run. ${remainingCooldown} seconds remaining.`);
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    this.logger.info("----------------------------------------");
    this.logger.info("Starting execution");

    for (let i = 0; i < this.tasks.length; i++) {
      await this.executeTask(this.tasks[i], i);
    }

    this.isRunning = false;
    this.lastFinishTime = Date.now();

    const executionTime = (this.lastFinishTime - startTime) / 1000;
    this.logger.info(`Execution completed. Time taken: ${executionTime.toFixed(1)} seconds`);

    if (this.scheduleConfig.cooldown > 0) {
      const nextRun = new Date(this.lastFinishTime + this.scheduleConfig.cooldown);
      this.logger.info(`Next earliest execution will be after ${nextRun.toLocaleString()}`);
    }

    this.logger.info("----------------------------------------");
  }

  private shouldRunImmediately(): boolean {
    if (!this.immediateEnvName) {
      return false;
    }
    const env = process.env as { [key: string]: string | undefined };
    return env[this.immediateEnvName] !== undefined;
  }

  async run(): Promise<void> {
    if (!this.shouldRunImmediately()) {
      this.logger.info(`Scheduling tasks. Pattern: ${this.scheduleConfig.schedule}, ` + `Cooldown: ${this.scheduleConfig.cooldown / 1000} seconds`);

      this.cronJob = new CronJob(this.scheduleConfig.schedule, () => this.executor());

      this.cronJob.start();
    } else {
      const envValue = (process.env as { [key: string]: string | undefined })[this.immediateEnvName!];
      this.logger.info(`Running immediately (${this.immediateEnvName}=${envValue})`);
      await this.executor();
    }
  }

  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.logger.info("Stopped scheduling future runs.");
    }
  }
}
