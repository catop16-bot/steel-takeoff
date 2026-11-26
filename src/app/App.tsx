import { Browser } from './Browser';
import { DrawingSettings, ImportDialog } from './dialogs/DrawingDialogs';
import { RecogHost } from './dialogs/RecognizeDialogs';
import { ArrayDialog, DuplicatesDialog } from './dialogs/EditDialogs';
import { importState } from './drawingFlows';
import { applyUpdate, openAnyFile, pwa } from './pwa';
import { GridDialog } from './dialogs/GridDialog';
import { LevelDialog } from './dialogs/LevelDialog';
import { HelpDialog, InfoDialog, InstallDialog, ProjectsDialog } from './dialogs/MiscDialogs';
import { ProfileBrowserHost } from './dialogs/ProfileBrowser';
import { ReportDialog } from './dialogs/ReportDialog';
import { PropertyPanel } from './PropertyPanel';
import { Ribbon } from './Ribbon';
import { StatusBar } from './StatusBar';
import { ui } from './ui';
import { ViewsArea } from './ViewsArea';

function Dialogs() {
  const d = ui.dialog.value;
  if (!d) return null;
  if (d === 'grid') return <GridDialog />;
  if (d.startsWith('grid:')) return <GridDialog key={d} gridId={d.slice(5)} />;
  if (d === 'levels') return <LevelDialog />;
  if (d === 'projects') return <ProjectsDialog />;
  if (d === 'info') return <InfoDialog />;
  if (d === 'help') return <HelpDialog />;
  if (d === 'report') return <ReportDialog />;
  if (d.startsWith('drawing:')) return <DrawingSettings key={d} id={d.slice(8)} />;
  if (d === 'array') return <ArrayDialog />;
  if (d === 'dups') return <DuplicatesDialog />;
  if (d === 'install') return <InstallDialog />;
  return null;
}

export function App() {
  return (
    <div
      class="app"
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const f = e.dataTransfer?.files?.[0];
        if (!f) return;
        e.preventDefault();
        void openAnyFile(f);
      }}
    >
      <Ribbon />
      <div class="main">
        <Browser />
        <ViewsArea />
        <PropertyPanel />
      </div>
      <StatusBar />
      <Dialogs />
      <RecogHost />
      <ProfileBrowserHost />
      {importState.value && <ImportDialog key={`${importState.value.file.name}|${importState.value.file.lastModified}|${importState.value.file.size}`} />}
      {ui.toast.value && <div class="toast">{ui.toast.value}</div>}
      {pwa.updateReady.value && (
        <div class="update-bar">
          已下載新版本
          <button class="primary" onClick={applyUpdate}>
            重新整理以更新
          </button>
          <button onClick={() => (pwa.updateReady.value = false)}>稍後</button>
        </div>
      )}
    </div>
  );
}
