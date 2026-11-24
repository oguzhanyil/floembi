using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

internal sealed class FloemwayService : ServiceBase
{
    private Process worker;
    private readonly object gate = new object();

    private FloemwayService() { ServiceName = "Floemway"; }

    protected override void OnStart(string[] args)
    {
        var directory = AppDomain.CurrentDomain.BaseDirectory;
        if (!File.Exists(Path.Combine(directory, "Private", "identity.json")))
            throw new InvalidOperationException("Önce Floemway kaydını hizmete aktarın.");
        lock (gate)
        {
            worker = new Process { StartInfo = new ProcessStartInfo {
                FileName = Path.Combine(directory, "worker", "floemway.exe"), Arguments = "--service",
                WorkingDirectory = directory, UseShellExecute = false, CreateNoWindow = true
            }};
            worker.EnableRaisingEvents = true;
            worker.Exited += WorkerExited;
            worker.Start();
        }
    }

    private void WorkerExited(object sender, EventArgs args)
    {
        lock (gate)
        {
            if (worker != sender) return;
            ExitCode = 1;
        }
        Stop();
    }

    protected override void OnStop()
    {
        lock (gate)
        {
            if (worker == null) return;
            worker.Exited -= WorkerExited;
            if (!worker.HasExited) { worker.Kill(); worker.WaitForExit(10000); }
            worker.Dispose();
            worker = null;
        }
    }

    private static void Main() { ServiceBase.Run(new FloemwayService()); }
}
