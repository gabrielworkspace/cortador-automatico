; Instalador do Cortador Automático (Inno Setup 6).
; Não compile direto: rode  node instalador/montar.js  - ele monta a pasta
; "montagem" com tudo que o programa precisa e chama o compilador.

#define Nome "Cortador Automático"
#define Versao "2.0.7"
#define Marca "Gabriel Workspace"
#define Exe "CortadorAutomatico.exe"
#ifndef MONTAGEM
  #define MONTAGEM "montagem"
#endif
#ifndef SAIDA
  #define SAIDA "dist"
#endif

[Setup]
AppId={{6E0B7A52-93D4-4C1F-8B2E-5A7C1D9F3E64}
AppName={#Nome}
AppVersion={#Versao}
AppVerName={#Nome}
AppPublisher={#Marca}
AppPublisherURL=https://www.instagram.com/gabriel.workspace/
AppSupportURL=https://gabrielworkspace.github.io/cortador-automatico/
AppUpdatesURL=https://gabrielworkspace.github.io/cortador-automatico/
AppCopyright=© 2026 {#Marca}
VersionInfoCompany={#Marca}
VersionInfoDescription=Instalador do {#Nome} - {#Marca}
VersionInfoProductName={#Nome}
VersionInfoVersion={#Versao}
; Instala só pra quem está usando o PC: não pede senha de administrador.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\CortadorAutomatico
DisableDirPage=yes
DisableProgramGroupPage=yes
DefaultGroupName={#Nome}
UninstallDisplayName={#Nome}
UninstallDisplayIcon={app}\{#Exe}
; Se o programa estiver aberto, o instalador pede pra fechar antes.
AppMutex=CortadorAutomatico
CloseApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
WizardSizePercent=110
SetupIconFile=imagens\icone.ico
WizardImageFile=imagens\lateral-0.bmp,imagens\lateral-1.bmp,imagens\lateral-2.bmp
WizardSmallImageFile=imagens\pequena-0.bmp,imagens\pequena-1.bmp,imagens\pequena-2.bmp
ShowLanguageDialog=no
OutputDir={#SAIDA}
OutputBaseFilename=Instalar-Cortador-Automatico
Compression=lzma2/max
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=2

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Messages]
WelcomeLabel2=Isso vai instalar o [name], do Gabriel Workspace, no seu computador.%n%nEle transforma vídeos e lives da Twitch, Kick e YouTube em cortes verticais prontos pro TikTok, Reels e Shorts - de vídeo gravado ou ao vivo, enquanto a live acontece.%n%nTudo roda no seu PC, de graça. Os cortes ficam na pasta Vídeos > Cortador Automatico.%n%nInstagram: @gabriel.workspace
FinishedLabel=Pronto! O [name] está instalado.%n%nÉ só abrir pelo atalho na área de trabalho ou no menu Iniciar.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; Atualização: tira os arquivos do programa antigo (os cortes ficam em Vídeos e não são tocados).
Type: filesandordirs; Name: "{app}\app"

[Files]
Source: "{#MONTAGEM}\modelos\*"; DestDir: "{app}\modelos"; Flags: ignoreversion recursesubdirs createallsubdirs nocompression
Source: "{#MONTAGEM}\*"; DestDir: "{app}"; Excludes: "\modelos"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#Nome}"; Filename: "{app}\{#Exe}"
Name: "{autodesktop}\{#Nome}"; Filename: "{app}\{#Exe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#Exe}"; Description: "Abrir o {#Nome} agora"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Modelos baixados depois, cache do Python e a janela do programa. Os cortes em Vídeos ficam.
Type: filesandordirs; Name: "{app}"
Type: filesandordirs; Name: "{localappdata}\CortadorAutomatico"
