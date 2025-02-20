import { TaskScheduler } from "../TaskScheduler";

describe("TaskScheduler", () => {
  let mockLogger: Console;
  let originalEnv: NodeJS.ProcessEnv;
  let scheduler: TaskScheduler;

  beforeEach(() => {
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
    jest.useRealTimers();
    if (scheduler) {
      scheduler.stop(); // Clean up any running cron jobs
    }
  });

  describe("Constructor and initialization", () => {
    it("should initialize with default values", () => {
      scheduler = new TaskScheduler();
      expect(scheduler).toBeDefined();
    });

    it("should handle invalid schedule string", () => {
      scheduler = new TaskScheduler("invalid * * * *", {
        logger: mockLogger,
        backupCooldownSeconds: 30,
      });
      scheduler.register(() => {});
      scheduler.run();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Scheduling tasks/));
    });

    it("should parse schedule string with cooldown", () => {
      scheduler = new TaskScheduler("*/5 * * * * * @ 30", {
        logger: mockLogger,
      });
      scheduler.register(() => {});
      scheduler.run();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Cooldown: 30 seconds/));
    });

    it("should use backup cooldown when not specified in schedule", () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        backupCooldownSeconds: 45,
        logger: mockLogger,
      });
      scheduler.register(() => {});
      scheduler.run();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Cooldown: 45 seconds/));
    });
  });

  describe("Task registration and execution", () => {
    it("should execute tasks in order", async () => {
      const results: number[] = [];
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      process.env.TEST = "true";

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

      process.env.TEST = "true";

      scheduler.register(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        results.push(1);
      });
      scheduler.register(async () => {
        results.push(2);
      });

      await scheduler.run();

      expect(results).toEqual([1, 2]);
    });

    it("should handle async task failures", async () => {
      const results: number[] = [];
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      process.env.TEST = "true";

      scheduler.register(async () => {
        results.push(1);
        throw new Error("Async task failed");
      });
      scheduler.register(async () => {
        results.push(2);
      });

      await scheduler.run();

      expect(results).toEqual([1, 2]);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should continue execution after task failure", async () => {
      const results: number[] = [];
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      process.env.TEST = "true";

      scheduler.register(() => results.push(1));
      scheduler.register(() => {
        throw new Error("Task failed");
      });
      scheduler.register(() => results.push(3));

      await scheduler.run();

      expect(results).toEqual([1, 3]);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("Cooldown handling", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

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
      await scheduler.run(); // Should be skipped due to cooldown

      expect(task).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Cooldown period not elapsed/));
    });

    it("should skip execution if already running", async () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      process.env.TEST = "true";

      // Create a long-running task
      scheduler.register(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      });

      // Start first execution
      const firstRun = scheduler.run();

      // Try to run again immediately
      await scheduler.run();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Previous execution still running/));

      // Wait for first run to complete
      await firstRun;
    });

    it("should allow execution after cooldown period", async () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        backupCooldownSeconds: 30,
        logger: mockLogger,
        immediateEnvName: "TEST",
      });

      process.env.TEST = "true";
      const task = jest.fn();
      scheduler.register(task);

      await scheduler.run();

      // Advance timer past cooldown
      jest.advanceTimersByTime(31000);

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
  });

  describe("Scheduler control", () => {
    it("should stop scheduled tasks", async () => {
      scheduler = new TaskScheduler("*/5 * * * * *", {
        logger: mockLogger,
      });

      scheduler.register(() => {});
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
  });
});
