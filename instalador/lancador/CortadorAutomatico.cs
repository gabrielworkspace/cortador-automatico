// Cortador Automatico - o .exe do atalho no desktop.
//
// Sobe o servidor (node) escondido, sem janela preta, abre a tela do programa
// numa janela propria do Edge (modo app, sem barra de endereco) e, quando essa
// janela fecha, encerra tudo: node, ffmpeg e python morrem junto, porque ficam
// num "job" do Windows amarrado a este processo.
//
// Compila com o csc do .NET Framework 4 que ja vem no Windows (ver montar.js).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Cortador Automático")]
[assembly: System.Reflection.AssemblyProduct("Cortador Automático")]
[assembly: System.Reflection.AssemblyDescription("Cortador Automático - Gabriel Workspace")]
[assembly: System.Reflection.AssemblyCompany("Gabriel Workspace")]
[assembly: System.Reflection.AssemblyCopyright("© 2026 Gabriel Workspace")]
[assembly: System.Reflection.AssemblyVersion("2.0.7.0")]
[assembly: System.Reflection.AssemblyFileVersion("2.0.7.0")]

static class Programa
{
    const string NOME = "Cortador Automático";

    static string pastaApp;       // onde o programa foi instalado
    static string pastaLocal;     // %LOCALAPPDATA%\CortadorAutomatico: registro, perfil da janela, endereco
    static string perfilJanela;   // perfil do Edge so nosso: fechar a janela = fechar o programa
    static string pastaDados;     // Videos\Cortador Automatico: cortes e videos baixados
    static string endereco;
    static Process servidor;
    static IntPtr job = IntPtr.Zero;
    static NotifyIcon icone;
    static StreamWriter registro;
    static readonly object travaRegistro = new object();
    static volatile bool encerrando;

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        pastaApp = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        pastaLocal = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CortadorAutomatico");
        perfilJanela = Path.Combine(pastaLocal, "janela");
        string videos = Environment.GetFolderPath(Environment.SpecialFolder.MyVideos);
        if (string.IsNullOrEmpty(videos)) videos = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Videos");
        pastaDados = Path.Combine(videos, "Cortador Automatico");
        string arquivoEndereco = Path.Combine(pastaLocal, "endereco.txt");

        bool primeiro;
        using (var trava = new Mutex(true, "CortadorAutomatico", out primeiro)) // o instalador espera ele fechar (AppMutex)
        {
            if (!primeiro)
            {
                // Ja esta aberto: so abre mais uma janela no mesmo servidor.
                try { AbrirJanela(File.ReadAllText(arquivoEndereco).Trim()); }
                catch { MessageBox.Show("O " + NOME + " já está aberto.", NOME, MessageBoxButtons.OK, MessageBoxIcon.Information); }
                return;
            }

            try
            {
                Directory.CreateDirectory(pastaLocal);
                Directory.CreateDirectory(pastaDados);
                registro = new StreamWriter(Path.Combine(pastaLocal, "registro.txt"), false, new UTF8Encoding(false));
                registro.AutoFlush = true;
            }
            catch { registro = null; }
            Registrar("Iniciando em " + pastaApp);

            ponte = new Control();
            IntPtr criarAgora = ponte.Handle; // amarra a ponte a esta thread

            Cursor.Current = Cursors.WaitCursor;
            string erro = SubirServidor();
            if (erro != null)
            {
                Registrar("ERRO: " + erro);
                Encerrar(false);
                MessageBox.Show(erro + "\n\nDetalhes em:\n" + Path.Combine(pastaLocal, "registro.txt"), NOME, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            try { File.WriteAllText(arquivoEndereco, endereco); } catch { }

            CriarIcone();
            Process janela = AbrirJanela(endereco);
            var vigia = new Thread(() => Vigiar(janela));
            vigia.IsBackground = true;
            vigia.Start();

            Application.Run();
            try { File.Delete(arquivoEndereco); } catch { }
        }
    }

    // ------------------------------------------------------------ servidor

    static string SubirServidor()
    {
        string node = Path.Combine(pastaApp, @"runtime\node\node.exe");
        string script = Path.Combine(pastaApp, @"app\src\server.js");
        if (!File.Exists(node) || !File.Exists(script))
            return "A instalação está incompleta (faltam arquivos do programa). Instale de novo.";

        var psi = new ProcessStartInfo(node, "\"" + script + "\"");
        psi.WorkingDirectory = Path.Combine(pastaApp, "app");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.StandardOutputEncoding = Encoding.UTF8;
        psi.StandardErrorEncoding = Encoding.UTF8;

        string runtime = Path.Combine(pastaApp, "runtime");
        var amb = psi.EnvironmentVariables;
        amb["DADOS"] = pastaDados;
        amb["MODELOS_DIR"] = Path.Combine(pastaApp, "modelos");
        amb["HF_HOME"] = Path.Combine(pastaApp, "modelos");
        amb["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1";
        amb["HF_HUB_DISABLE_TELEMETRY"] = "1";
        amb["PYTHON_BIN"] = Path.Combine(runtime, @"python\python.exe");
        amb["FFMPEG_PATH"] = Path.Combine(runtime, @"ffmpeg\ffmpeg.exe");
        amb["FFPROBE_PATH"] = Path.Combine(runtime, @"ffmpeg\ffprobe.exe");
        amb["YTDLP_PATH"] = Path.Combine(runtime, "yt-dlp.exe");
        amb["PYTHONNOUSERSITE"] = "1"; // nao mistura com bibliotecas de outro Python da maquina
        amb["NAO_ABRIR"] = "1";   // quem abre a janela somos nos
        // o yt-dlp acha o ffmpeg pelo PATH pra juntar audio e video
        amb["PATH"] = Path.Combine(runtime, "ffmpeg") + ";" + Path.Combine(runtime, "node") + ";" + (amb["PATH"] ?? "");

        var pronto = new ManualResetEvent(false);
        var regex = new Regex(@"rodando em (http://127\.0\.0\.1:\d+)");
        DataReceivedEventHandler aoLer = (s, e) =>
        {
            if (e.Data == null) return;
            Registrar(e.Data);
            var m = regex.Match(e.Data);
            if (m.Success && endereco == null) { endereco = m.Groups[1].Value; pronto.Set(); }
        };

        try
        {
            servidor = new Process();
            servidor.StartInfo = psi;
            servidor.EnableRaisingEvents = true;
            servidor.OutputDataReceived += aoLer;
            servidor.ErrorDataReceived += aoLer;
            servidor.Exited += (s, e) => { pronto.Set(); ServidorParou(); };
            servidor.Start();
            AmarrarAoJob(servidor);
            servidor.BeginOutputReadLine();
            servidor.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            return "Não consegui iniciar o programa: " + ex.Message;
        }

        pronto.WaitOne(60000);
        if (endereco == null) return "O programa não conseguiu iniciar.";
        Registrar("Servidor pronto em " + endereco);
        return null;
    }

    static void ServidorParou()
    {
        if (encerrando) return;
        if (endereco == null) return; // ainda subindo: quem trata e o SubirServidor
        Registrar("O servidor parou sozinho (codigo " + SafeExitCode() + ").");
        Executar(() =>
        {
            MessageBox.Show("O " + NOME + " parou de funcionar e vai fechar.\n\nDetalhes em:\n" + Path.Combine(pastaLocal, "registro.txt"),
                NOME, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Encerrar(true);
        });
    }

    static string SafeExitCode()
    {
        try { return servidor.ExitCode.ToString(); } catch { return "?"; }
    }

    // ------------------------------------------------------------ janela

    static List<string> Navegadores()
    {
        var lista = new List<string>();
        string x86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string pf = Environment.GetEnvironmentVariable("ProgramW6432") ?? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        foreach (var exe in new[] { "msedge.exe", "chrome.exe" })
        {
            foreach (var raiz in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                try
                {
                    using (var k = raiz.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                    {
                        var v = k == null ? null : k.GetValue("") as string;
                        if (!string.IsNullOrEmpty(v)) lista.Add(v.Trim('"'));
                    }
                }
                catch { }
            }
            string pasta = exe == "msedge.exe" ? @"Microsoft\Edge\Application" : @"Google\Chrome\Application";
            foreach (var baseDir in new[] { x86, pf, local })
                if (!string.IsNullOrEmpty(baseDir)) lista.Add(Path.Combine(baseDir, pasta, exe));
        }
        return lista;
    }

    static Process AbrirJanela(string url)
    {
        foreach (var nav in Navegadores())
        {
            if (!File.Exists(nav)) continue;
            try
            {
                var psi = new ProcessStartInfo(nav,
                    "--app=" + url +
                    " --user-data-dir=\"" + perfilJanela + "\"" +
                    " --no-first-run --no-default-browser-check --disable-sync" +
                    " --window-size=1180,880");
                psi.UseShellExecute = false;
                Registrar("Abrindo a janela com " + nav);
                return Process.Start(psi);
            }
            catch (Exception ex) { Registrar("Falhou " + nav + ": " + ex.Message); }
        }
        // Sem Edge nem Chrome: abre no navegador padrao e o programa fica no icone perto do relogio.
        try { Process.Start(url); } catch { }
        return null;
    }

    /** O processo principal do Edge com o nosso perfil (o que segura as janelas), se houver. */
    static Process ProcessoDaJanela()
    {
        string perfil = perfilJanela.ToLowerInvariant();
        try
        {
            using (var busca = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='msedge.exe' OR Name='chrome.exe'"))
            {
                foreach (ManagementObject o in busca.Get())
                {
                    string cmd = ((o["CommandLine"] as string) ?? "").ToLowerInvariant();
                    if (!cmd.Contains(perfil) || cmd.Contains("--type=")) continue;
                    try { return Process.GetProcessById(Convert.ToInt32(o["ProcessId"])); } catch { }
                }
            }
        }
        catch (Exception ex) { Registrar("Nao consegui olhar os processos: " + ex.Message); }
        return null;
    }

    /** Fica de olho na janela: fechou a ultima, fecha o programa. */
    static void Vigiar(Process janela)
    {
        if (janela == null) return; // navegador padrao: so fecha pelo icone
        Process atual = janela;
        while (!encerrando)
        {
            try { atual.WaitForExit(); Registrar("Processo da janela " + atual.Id + " saiu (codigo " + atual.ExitCode + ")."); }
            catch (Exception ex) { Registrar("Vigia: " + ex.Message); }
            // Se o Edge ja estava aberto com o nosso perfil, o processo que
            // chamamos so passa o recado e sai: procura quem ficou com a janela.
            // Da uns segundos de folga pro Edge que se reinicia (atualizacao).
            atual = null;
            for (int tentativa = 0; tentativa < 4 && atual == null && !encerrando; tentativa++)
            {
                Thread.Sleep(1500);
                atual = ProcessoDaJanela();
            }
            if (atual == null) break;
            Registrar("A janela continua aberta no processo " + atual.Id + ".");
        }
        Registrar("A janela foi fechada.");
        Executar(() => Encerrar(true));
    }

    // ------------------------------------------------------------ icone perto do relogio

    static void CriarIcone()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir o Cortador", null, (s, e) => AbrirJanela(endereco));
        menu.Items.Add("Abrir a pasta dos cortes", null, (s, e) => AbrirPasta());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Fechar o programa", null, (s, e) => { FecharJanelas(); Encerrar(true); });

        icone = new NotifyIcon();
        try { icone.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { icone.Icon = SystemIcons.Application; }
        icone.Text = NOME;
        icone.ContextMenuStrip = menu;
        icone.DoubleClick += (s, e) => AbrirJanela(endereco);
        icone.Visible = true;
    }

    // A pasta que a pessoa escolheu nos Ajustes do programa (config.json, o
    // mesmo que o src/pastas.js grava); sem escolha, a de sempre.
    static string PastaDadosAtual()
    {
        try
        {
            string cfg = Path.Combine(pastaLocal, "config.json");
            if (File.Exists(cfg))
            {
                var m = Regex.Match(File.ReadAllText(cfg), "\"pastaDados\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
                if (m.Success)
                {
                    string p = Regex.Unescape(m.Groups[1].Value);
                    if (Path.IsPathRooted(p)) return p;
                }
            }
        }
        catch { }
        return pastaDados;
    }

    static void AbrirPasta()
    {
        string saida = Path.Combine(PastaDadosAtual(), "saida");
        try { Directory.CreateDirectory(saida); Process.Start("explorer.exe", "\"" + saida + "\""); } catch { }
    }

    static void FecharJanelas()
    {
        var p = ProcessoDaJanela();
        if (p == null) return;
        try { p.CloseMainWindow(); p.WaitForExit(4000); } catch { }
    }

    static void Encerrar(bool sairDoLaco)
    {
        if (encerrando && sairDoLaco) { Application.Exit(); return; }
        encerrando = true;
        if (icone != null) { icone.Visible = false; icone.Dispose(); }
        // fecha o job: o Windows mata o node e tudo que ele abriu (ffmpeg, python, yt-dlp)
        if (job != IntPtr.Zero) { TerminateJobObject(job, 0); CloseHandle(job); job = IntPtr.Zero; }
        try { if (servidor != null && !servidor.HasExited) servidor.Kill(); } catch { }
        Registrar("Programa encerrado.");
        if (sairDoLaco) Application.Exit();
    }

    // Roda na thread da interface (o icone e as caixas de mensagem sao de la).
    static Control ponte;
    static void Executar(Action acao)
    {
        if (ponte == null) { acao(); return; }
        try { ponte.BeginInvoke(acao); } catch { acao(); }
    }

    static void Registrar(string linha)
    {
        lock (travaRegistro)
        {
            if (registro == null) return;
            try
            {
                if (registro.BaseStream.Length > 5 * 1024 * 1024) return;
                registro.WriteLine(DateTime.Now.ToString("HH:mm:ss") + "  " + linha);
            }
            catch { }
        }
    }

    // ------------------------------------------------------------ job do Windows

    static void AmarrarAoJob(Process p)
    {
        try
        {
            job = CreateJobObject(IntPtr.Zero, null);
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int tamanho = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            if (!SetInformationJobObject(job, 9, ref info, tamanho) || !AssignProcessToJobObject(job, p.Handle))
                Registrar("Aviso: nao consegui amarrar o servidor ao job (" + Marshal.GetLastWin32Error() + ").");
        }
        catch (Exception ex) { Registrar("Aviso: job: " + ex.Message); }
    }

    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr atributos, string nome);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int classe, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int tamanho);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr processo);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint codigo);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
}
