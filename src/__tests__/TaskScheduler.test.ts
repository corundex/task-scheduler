import { TaskScheduler } from "../TaskScheduler";

// Set global timeout for all tests
jest.setTimeout(5000);

describe("TaskScheduler", () => {
  let mockLogger: Console;
  let originalEnv: NodeJS.ProcessEnv;
  let scheduler: TaskScheduler;

  beforeEach(() => {
    jest.useFakeTimers();
    originalEnv = { ...process.env };
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    } as unknown as Console;
  });

  afterEach(() => {
    process.env = originalEnv;
    if (scheduler) {
      scheduler.stop();
    }
    jest.useRealTimers();
  });

  describe("Constructor and initialization", () => {
    it("should initialize with default values", () => {
      scheduler = new TaskScheduler();
      expect(scheduler).toBeDefined();
    });

    it("should throw error for empty schedule string", () => {
      expect(() => {
        new TaskScheduler("", { logger: mockLogger });
      }).toThrow("Schedule string cannot be empty");
    });

    it("should throw error for invalid schedule string", () => {
      scheduler = new TaskScheduler("invalid * * * *", { logger: mockLogger });
      expect(() => scheduler.run()).rejects.toThrow();
    });

    it("should parse schedule string with cooldown", async () => {
      scheduler = new TaskScheduler("*/5 * * * * * @ 30", { logger: mockLogger });
      scheduler.register(jest.fn());
      await scheduler.run();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Cooldown: 30 seconds/));
    });

    it("should use backup cooldown when not specified in schedule", async () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        backupCooldownSeconds: 45,
        logger: mockLogger,
      });
      scheduler.register(jest.fn());
      await scheduler.run();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Cooldown: 45 seconds/));
    });
  });

  describe("Task registration and execution", () => {
    beforeEach(() => {
      process.env.TEST = "true";
    });

    it("should execute tasks in order", async () => {
      const results: number[] = [];
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      scheduler.register(() => results.push(1));
      scheduler.register(() => results.push(2));
      scheduler.register(() => results.push(3));

      await scheduler.run();
      expect(results).toEqual([1, 2, 3]);
    });

    it("should handle async tasks", async () => {
      const results: number[] = [];
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      scheduler.register(async () => {
        await Promise.resolve();
        results.push(1);
      });
      scheduler.register(async () => {
        results.push(2);
      });

      await scheduler.run();
      expect(results).toEqual([1, 2]);
    });

    it("should handle task errors", async () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      const errorTask = jest.fn().mockRejectedValue(new Error("Task failed"));
      const nextTask = jest.fn();

      scheduler.register(errorTask);
      scheduler.register(nextTask);

      await scheduler.run();

      expect(errorTask).toHaveBeenCalled();
      expect(nextTask).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith("Task 1 failed:", expect.any(Error));
    });
  });

  describe("Cooldown handling", () => {
    it("should respect cooldown period", async () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        backupCooldownSeconds: 30,
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      process.env.TEST = "true";
      const task = jest.fn();
      scheduler.register(task);

      await scheduler.run();
      jest.advanceTimersByTime(15000); // Half the cooldown
      await scheduler.run();

      expect(task).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Cooldown period not elapsed/));
    });

    it("should skip execution if already running", async () => {
      process.env.TEST = "true";
      let resolveTask: () => void;

      const controlledTask = new Promise<void>((resolve) => {
        resolveTask = resolve;
      });

      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      scheduler.register(async () => {
        await controlledTask;
      });

      const firstRun = scheduler.run();
      await scheduler.run();

      expect(mockLogger.info).toHaveBeenCalledWith("Previous execution still running. Skipping this run.");

      resolveTask!();
      await firstRun;
    });

    it("should allow execution after cooldown", async () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        backupCooldownSeconds: 30,
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      process.env.TEST = "true";
      const task = jest.fn();
      scheduler.register(task);

      await scheduler.run();
      jest.advanceTimersByTime(31000); // Just past cooldown
      await scheduler.run();

      expect(task).toHaveBeenCalledTimes(2);
    });
  });

  describe("Environment handling", () => {
    it("should run immediately when environment variable is set", async () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      process.env.TEST = "true";
      const task = jest.fn();
      scheduler.register(task);

      await scheduler.run();

      expect(task).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Running immediately/));
    });

    it("should schedule tasks when environment variable is not set", async () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      const task = jest.fn();
      scheduler.register(task);

      await scheduler.run();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Scheduling tasks/));
    });

    it("should handle undefined environment variable", async () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
        immediateEnvName: undefined,
      });

      const task = jest.fn();
      scheduler.register(task);

      await scheduler.run();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Scheduling tasks/));
    });
  });

  describe("Scheduler control", () => {
    it("should stop scheduled tasks", async () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
      });

      scheduler.register(jest.fn());
      await scheduler.run();
      scheduler.stop();

      expect(mockLogger.info).toHaveBeenCalledWith("Stopped scheduling future runs.");
    });

    it("should handle stop when no tasks are scheduled", () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
      });

      scheduler.stop();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it("should handle multiple stop calls", () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
      });

      scheduler.stop();
      scheduler.stop();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });
});
