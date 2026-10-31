using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace PizzaManagerLauncher
{
    static class Program
    {
        private const string Url = "http://localhost:3000";
        private const int Port = 3000;
        private const string BaseDir = @"C:\Projeot\pizzamanager";

        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                EnsureServerRunning();
                OpenAppWindow();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Erro ao iniciar o Pizza Manager:\n" + ex.Message, "Pizza Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        static bool IsServerListening()
        {
            try
            {
                using (var tcp = new TcpClient())
                {
                    var ar = tcp.BeginConnect("127.0.0.1", Port, null, null);
                    bool success = ar.AsyncWaitHandle.WaitOne(400);
                    if (!success) return false;
                    tcp.EndConnect(ar);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        static void EnsureServerRunning()
        {
            if (IsServerListening()) return;

            string nodeExe = Path.Combine(BaseDir, @"runtime\node-v18.20.4-win-x64\node.exe");
            if (!File.Exists(nodeExe))
            {
                nodeExe = "node.exe";
            }

            string serverJs = Path.Combine(BaseDir, "server.js");
            if (!File.Exists(serverJs))
            {
                throw new FileNotFoundException("Arquivo server.js não encontrado em: " + BaseDir);
            }

            var psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = "server.js",
                WorkingDirectory = BaseDir,
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            // Adiciona o runtime ao PATH
            string nodeDir = Path.GetDirectoryName(nodeExe);
            if (Directory.Exists(nodeDir))
            {
                string existingPath = Environment.GetEnvironmentVariable("PATH") ?? "";
                psi.EnvironmentVariables["PATH"] = nodeDir + ";" + existingPath;
            }

            Process.Start(psi);

            // Aguarda o servidor responder na porta 3000 (até 8 segundos)
            for (int i = 0; i < 40; i++)
            {
                Thread.Sleep(200);
                if (IsServerListening()) return;
            }
        }

        static void OpenAppWindow()
        {
            string[] chromePaths = new string[]
            {
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
            };

            foreach (var cp in chromePaths)
            {
                if (File.Exists(cp))
                {
                    Process.Start(cp, "--app=" + Url);
                    return;
                }
            }

            string[] edgePaths = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
            };

            foreach (var ep in edgePaths)
            {
                if (File.Exists(ep))
                {
                    Process.Start(ep, "--app=" + Url);
                    return;
                }
            }

            // Fallback para o navegador padrão
            Process.Start(new ProcessStartInfo
            {
                FileName = Url,
                UseShellExecute = true
            });
        }
    }
}