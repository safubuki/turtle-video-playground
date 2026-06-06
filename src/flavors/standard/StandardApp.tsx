import AppShell from '../../app/AppShell';
import TurtleVideo from '../../components/TurtleVideo';
import { standardExportRuntime } from './standardExportRuntime';
import { standardPreviewRuntime } from './standardPreviewRuntime';
import { standardSaveRuntime } from './standardSaveRuntime';

function StandardApp() {
  return (
    <AppShell>
      <TurtleVideo
        appFlavor="standard"
        previewRuntime={standardPreviewRuntime}
        exportRuntime={standardExportRuntime}
        saveRuntime={standardSaveRuntime}
      />
    </AppShell>
  );
}

export default StandardApp;