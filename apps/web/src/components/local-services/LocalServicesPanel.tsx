'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@podex/ui';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Server,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  Cpu,
  Database,
} from 'lucide-react';

interface LocalServicesStatus {
  docker: {
    status: string;
    version: string | null;
    running: boolean;
  };
  localPod: {
    status: string;
    running: boolean;
    activeWorkspaces: number;
  };
  ollama: {
    status: string;
    running: boolean;
    modelsCount: number;
    bridgeConnected: boolean;
  };
  lmstudio: {
    status: string;
    running: boolean;
    modelsCount: number;
    bridgeConnected: boolean;
  };
  offlineCache: {
    enabled: boolean;
    sessionsCount: number;
    isOnline: boolean;
  };
  guidedSetup: {
    completed: boolean;
    currentStep: string;
  };
}

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
}

function StatusBadge({ status, running }: { status: string; running?: boolean }) {
  if (running === true || status === 'running') {
    return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Running</Badge>;
  }
  if (status === 'stopped') {
    return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Stopped</Badge>;
  }
  if (status === 'not_installed') {
    return <Badge className="bg-gray-500/10 text-gray-500 border-gray-500/20">Not Installed</Badge>;
  }
  if (status === 'error') {
    return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Error</Badge>;
  }
  return <Badge className="bg-gray-500/10 text-gray-500 border-gray-500/20">Checking...</Badge>;
}

export function LocalServicesPanel() {
  const [status, setStatus] = useState<LocalServicesStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [isElectron, setIsElectron] = useState(false);

  // Section expansion states
  const [dockerOpen, setDockerOpen] = useState(true);
  const [localPodOpen, setLocalPodOpen] = useState(true);
  const [ollamaOpen, setOllamaOpen] = useState(true);
  const [lmstudioOpen, setLmstudioOpen] = useState(false);
  const [cacheOpen, setCacheOpen] = useState(false);

  // Ollama specific state
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<number>(0);

  const loadStatus = useCallback(async () => {
    const electron = window.electronAPI;
    if (!electron) return;

    try {
      const currentStatus = await electron.localServices.getStatus();
      setStatus(currentStatus);

      // Load Ollama models if running
      if (currentStatus.ollama.running) {
        const info = await electron.localServices.ollama.getInfo();
        setOllamaModels(info.models || []);
      }
    } catch (error) {
      console.error('Failed to load local services status:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check if running in Electron
    const electron = typeof window !== 'undefined' && window.electronAPI;
    setIsElectron(!!electron);

    if (electron) {
      loadStatus();

      // Subscribe to status updates
      const unsubscribe = electron.localServices.onStatusUpdate(
        (newStatus: LocalServicesStatus) => {
          setStatus(newStatus);
        }
      );

      return () => {
        unsubscribe();
      };
    } else {
      setLoading(false);
      return undefined;
    }
  }, [loadStatus]);

  const handleStartDocker = async () => {
    const electron = window.electronAPI;
    if (!electron) return;
    await electron.localServices.docker.start();
  };

  const handleStartLocalPod = async () => {
    const electron = window.electronAPI;
    if (!electron) return;
    const result = await electron.localServices.localPod.start();
    if (!result.success) {
      console.error('Failed to start local pod:', result.error);
    }
  };

  const handleStopLocalPod = async () => {
    const electron = window.electronAPI;
    if (!electron) return;
    await electron.localServices.localPod.stop();
  };

  const handleStartOllama = async () => {
    const electron = window.electronAPI;
    if (!electron) return;
    await electron.localServices.ollama.start();
  };

  const handlePullModel = async (modelName: string) => {
    const electron = window.electronAPI;
    if (!electron) return;
    setPullingModel(modelName);
    setPullProgress(0);

    // Subscribe to progress
    const unsubscribe = electron.localServices.ollama.onPullProgress(
      (progress: { status: string; completed?: number; total?: number }) => {
        if (progress.completed && progress.total) {
          setPullProgress((progress.completed / progress.total) * 100);
        }
      }
    );

    try {
      await electron.localServices.ollama.pullModel(modelName);
      await loadStatus();
    } finally {
      unsubscribe();
      setPullingModel(null);
      setPullProgress(0);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    const electron = window.electronAPI;
    if (!electron) return;
    await electron.localServices.ollama.deleteModel(modelName);
    await loadStatus();
  };

  const handleConnectBridge = async (provider: 'ollama' | 'lmstudio') => {
    const electron = window.electronAPI;
    if (!electron) return;
    // In a real implementation, you'd get these from the user's auth state
    const cloudUrl = 'https://api.podex.dev';
    const authToken = 'user-auth-token'; // Get from auth state

    if (provider === 'ollama') {
      await electron.localServices.ollama.connectBridge(cloudUrl, authToken);
    } else {
      await electron.localServices.lmstudio.connectBridge(cloudUrl, authToken);
    }
  };

  const handleClearCache = async () => {
    const electron = window.electronAPI;
    if (!electron) return;
    await electron.localServices.cache.clear();
    await loadStatus();
  };

  const handleOpenSetup = async () => {
    const electron = window.electronAPI;
    if (!electron) return;
    await electron.localServices.setup.reset();
    await electron.localServices.setup.start();
  };

  if (!isElectron) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="w-5 h-5" />
            Local Development
          </CardTitle>
          <CardDescription>
            Local development features are only available in the desktop app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Download the Podex desktop app to run workspaces and AI models locally on your machine.
          </p>
          <Button className="mt-4" asChild>
            <a href="https://podex.dev/download" target="_blank" rel="noopener noreferrer">
              <Download className="w-4 h-4 mr-2" />
              Download Desktop App
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="w-5 h-5" />
                Local Development
              </CardTitle>
              <CardDescription>Run workspaces and AI models on your local machine</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {status?.offlineCache.isOnline ? (
                <Badge className="bg-green-500/10 text-green-500">
                  <Wifi className="w-3 h-3 mr-1" />
                  Online
                </Badge>
              ) : (
                <Badge className="bg-yellow-500/10 text-yellow-500">
                  <WifiOff className="w-3 h-3 mr-1" />
                  Offline
                </Badge>
              )}
              <Button variant="outline" size="sm" onClick={loadStatus}>
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Docker Section */}
      <Collapsible open={dockerOpen} onOpenChange={setDockerOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {dockerOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <Server className="w-5 h-5" />
                  <div>
                    <CardTitle className="text-base">Docker</CardTitle>
                    <CardDescription className="text-xs">
                      {status?.docker.version ? `v${status.docker.version}` : 'Container runtime'}
                    </CardDescription>
                  </div>
                </div>
                <StatusBadge status={status?.docker.status || 'checking'} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              {status?.docker.status === 'not_installed' && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Docker is required for running local workspaces.
                  </p>
                  <Button asChild>
                    <a
                      href="https://www.docker.com/products/docker-desktop/"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Install Docker Desktop
                    </a>
                  </Button>
                </div>
              )}
              {status?.docker.status === 'stopped' && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Docker is installed but not running.
                  </p>
                  <Button onClick={handleStartDocker}>
                    <Play className="w-4 h-4 mr-2" />
                    Start Docker
                  </Button>
                </div>
              )}
              {status?.docker.running && (
                <div className="flex items-center gap-2 text-sm text-green-500">
                  <CheckCircle2 className="w-4 h-4" />
                  Docker is running and ready
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Local Pod Section */}
      <Collapsible open={localPodOpen} onOpenChange={setLocalPodOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {localPodOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <Cpu className="w-5 h-5" />
                  <div>
                    <CardTitle className="text-base">Local Pod</CardTitle>
                    <CardDescription className="text-xs">
                      {status?.localPod.running
                        ? `${status.localPod.activeWorkspaces} active workspace(s)`
                        : 'Run workspaces locally'}
                    </CardDescription>
                  </div>
                </div>
                <StatusBadge
                  status={status?.localPod.status || 'stopped'}
                  running={status?.localPod.running}
                />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <p className="text-sm text-muted-foreground">
                Run development workspaces on this machine instead of the cloud.
              </p>

              <div className="flex items-center gap-2">
                {status?.localPod.running ? (
                  <Button variant="danger" onClick={handleStopLocalPod}>
                    <Square className="w-4 h-4 mr-2" />
                    Stop
                  </Button>
                ) : (
                  <Button onClick={handleStartLocalPod} disabled={!status?.docker.running}>
                    <Play className="w-4 h-4 mr-2" />
                    Start
                  </Button>
                )}
              </div>

              {!status?.docker.running && (
                <p className="text-xs text-yellow-500 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Docker must be running to start the local pod
                </p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Ollama Section */}
      <Collapsible open={ollamaOpen} onOpenChange={setOllamaOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {ollamaOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <span className="text-xl">🦙</span>
                  <div>
                    <CardTitle className="text-base">Ollama</CardTitle>
                    <CardDescription className="text-xs">
                      {status?.ollama.running
                        ? `${status.ollama.modelsCount} model(s) available`
                        : 'Local LLM inference'}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {status?.ollama.bridgeConnected && (
                    <Badge className="bg-blue-500/10 text-blue-500">Bridge Active</Badge>
                  )}
                  <StatusBadge status={status?.ollama.status || 'checking'} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              {status?.ollama.status === 'not_installed' && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Install Ollama to run AI models locally on your machine.
                  </p>
                  <Button asChild>
                    <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Install Ollama
                    </a>
                  </Button>
                </div>
              )}

              {status?.ollama.status === 'stopped' && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Ollama is installed but not running.
                  </p>
                  <Button onClick={handleStartOllama}>
                    <Play className="w-4 h-4 mr-2" />
                    Start Ollama
                  </Button>
                </div>
              )}

              {status?.ollama.running && (
                <div className="space-y-4">
                  {/* Models List */}
                  <div>
                    <Label className="text-sm font-medium">Installed Models</Label>
                    {ollamaModels.length === 0 ? (
                      <p className="text-sm text-muted-foreground mt-2">No models installed yet.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {ollamaModels.map((model) => (
                          <div
                            key={model.name}
                            className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                          >
                            <div>
                              <p className="text-sm font-medium">{model.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {(model.size / 1e9).toFixed(1)} GB
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteModel(model.name)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Recommended Models */}
                  <div>
                    <Label className="text-sm font-medium">Recommended Models</Label>
                    <div className="mt-2 space-y-2">
                      {[
                        { name: 'qwen2.5-coder:14b', desc: 'Best for coding', size: '14GB' },
                        { name: 'qwen2.5-coder:7b', desc: 'Faster, smaller', size: '7GB' },
                        { name: 'llama3.1:8b', desc: 'General purpose', size: '8GB' },
                      ].map((model) => {
                        const modelPrefix = model.name.split(':')[0];
                        if (!modelPrefix) {
                          return null;
                        }
                        const isInstalled = ollamaModels.some((m) =>
                          m.name.startsWith(modelPrefix)
                        );
                        const isPulling = pullingModel === model.name;

                        return (
                          <div
                            key={model.name}
                            className="flex items-center justify-between p-2 rounded-lg border"
                          >
                            <div>
                              <p className="text-sm font-medium">{model.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {model.desc} • {model.size}
                              </p>
                            </div>
                            {isPulling ? (
                              <div className="w-24">
                                <Progress value={pullProgress} className="h-2" />
                              </div>
                            ) : isInstalled ? (
                              <Badge variant="outline">Installed</Badge>
                            ) : (
                              <Button size="sm" onClick={() => handlePullModel(model.name)}>
                                <Download className="w-4 h-4 mr-1" />
                                Pull
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bridge Connection */}
                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium">LLM Bridge</Label>
                        <p className="text-xs text-muted-foreground">
                          Allow cloud agents to use your local models
                        </p>
                      </div>
                      <Switch
                        checked={status?.ollama.bridgeConnected}
                        onCheckedChange={(checked: boolean) => {
                          const electron = window.electronAPI;
                          if (!electron) return;
                          if (checked) {
                            handleConnectBridge('ollama');
                          } else {
                            electron.localServices.ollama.disconnectBridge();
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* LM Studio Section */}
      <Collapsible open={lmstudioOpen} onOpenChange={setLmstudioOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {lmstudioOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <span className="text-xl">🎛️</span>
                  <div>
                    <CardTitle className="text-base">LM Studio</CardTitle>
                    <CardDescription className="text-xs">
                      {status?.lmstudio.running
                        ? `${status.lmstudio.modelsCount} model(s) loaded`
                        : 'GUI-based local LLM'}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {status?.lmstudio.bridgeConnected && (
                    <Badge className="bg-blue-500/10 text-blue-500">Bridge Active</Badge>
                  )}
                  <StatusBadge status={status?.lmstudio.status || 'checking'} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              {status?.lmstudio.status !== 'running' ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    LM Studio provides a GUI for running local LLMs.
                  </p>
                  <Button asChild>
                    <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Get LM Studio
                    </a>
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    After installing, open LM Studio and start the local server from the &quot;Local
                    Server&quot; tab.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-green-500">
                    <CheckCircle2 className="w-4 h-4" />
                    LM Studio server is running
                  </div>

                  {/* Bridge Connection */}
                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium">LLM Bridge</Label>
                        <p className="text-xs text-muted-foreground">
                          Allow cloud agents to use your local models
                        </p>
                      </div>
                      <Switch
                        checked={status?.lmstudio.bridgeConnected}
                        onCheckedChange={(checked: boolean) => {
                          const electron = window.electronAPI;
                          if (!electron) return;
                          if (checked) {
                            handleConnectBridge('lmstudio');
                          } else {
                            electron.localServices.lmstudio.disconnectBridge();
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Offline Cache Section */}
      <Collapsible open={cacheOpen} onOpenChange={setCacheOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {cacheOpen ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <Database className="w-5 h-5" />
                  <div>
                    <CardTitle className="text-base">Offline Cache</CardTitle>
                    <CardDescription className="text-xs">
                      {status?.offlineCache.sessionsCount || 0} sessions cached
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline">
                  {status?.offlineCache.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <p className="text-sm text-muted-foreground">
                View cached sessions and files when offline.
              </p>

              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleClearCache}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Clear Cache
                </Button>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Setup Button */}
      {!status?.guidedSetup.completed && (
        <Card>
          <CardContent className="py-4">
            <Button onClick={handleOpenSetup} className="w-full">
              Run Guided Setup
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
