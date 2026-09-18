import { useMemo } from 'react';
import { Box, Flex } from '@chakra-ui/react';

import { CodeTab, PreviewTab, TabsLayout } from '../../components/common/TabsLayout';
import Customize from '../../components/common/Preview/Customize';
import CodeExample from '../../components/code/CodeExample';
import PropTable from '../../components/common/Preview/PropTable';
import Dependencies from '../../components/code/Dependencies';
import PreviewSlider from '../../components/common/Preview/PreviewSlider';
import PreviewSwitch from '../../components/common/Preview/PreviewSwitch';
import PreviewSelect from '../../components/common/Preview/PreviewSelect';
import PreviewColorPickerCustom from '../../components/common/Preview/PreviewColorPickerCustom';
import BackgroundContent from '../../components/common/Preview/BackgroundContent';
import OpenInStudioButton from '../../components/common/Preview/OpenInStudioButton';

import useForceRerender from '../../hooks/useForceRerender';
import useComponentProps from '../../hooks/useComponentProps';
import { ComponentPropsProvider } from '../../components/context/ComponentPropsContext';

import GhostFibers from '@/content/Backgrounds/GhostFibers/GhostFibers';
import { ghostFibers } from '../../constants/code/Backgrounds/ghostFibersCode';

const DEFAULT_PROPS = {
  lineColor: '#140E35',
  glowColor: '#3437A0',
  speed: 0.2,
  scale: 2,
  rotation: 0,
  rotationSpeed: 0.25,
  layers: 4,
  waveAmplitude: 0.015,
  waveFrequency: 3,
  waveSpeed: 0.15,
  layerSpeed: 0.08,
  twist: 0.1,
  twistFrequency: 5,
  twistSpeed: 1.2,
  lineFrequency: 5,
  lineSpacing: 2,
  lineSharpness: 16,
  glowFalloff: 10,
  glowIntensity: 1.6,
  brightness: 2,
  blueBoost: 1.25,
  vignette: 0.8,
  grain: 0.05,
  lightMode: false,
  dpr: 1,
  fps: 60,
  paused: false
};

const GhostFibersDemo = () => {
  const { props, updateProp, resetProps, hasChanges } = useComponentProps(DEFAULT_PROPS);
  const [key, forceRerender] = useForceRerender();

  const propData = useMemo(
    () => [
      { name: 'lineColor', type: 'string', default: "'#140E35'", description: 'Color of the thin fiber cores.' },
      { name: 'glowColor', type: 'string', default: "'#3437A0'", description: 'Color of the broad luminous bands.' },
      { name: 'speed', type: 'number', default: '0.2', description: 'Master animation speed.' },
      { name: 'scale', type: 'number', default: '2', description: 'Zoom level of the field.' },
      { name: 'rotation', type: 'number', default: '0', description: 'Static field rotation in degrees.' },
      { name: 'rotationSpeed', type: 'number', default: '0.25', description: 'Continuous rotation rate.' },
      { name: 'layers', type: 'number', default: '4', description: 'Number of cumulative fiber layers, from 1 to 10.' },
      {
        name: 'waveAmplitude',
        type: 'number',
        default: '0.015',
        description: 'Strength of the recursive wave displacement.'
      },
      {
        name: 'waveFrequency',
        type: 'number',
        default: '3',
        description: 'Frequency of the recursive wave displacement.'
      },
      { name: 'waveSpeed', type: 'number', default: '0.15', description: 'Base speed of the layered waves.' },
      {
        name: 'layerSpeed',
        type: 'number',
        default: '0.08',
        description: 'Additional wave speed contributed by each layer.'
      },
      {
        name: 'twist',
        type: 'number',
        default: '0.1',
        description: 'Angular distortion applied during each iteration.'
      },
      {
        name: 'twistFrequency',
        type: 'number',
        default: '5',
        description: 'Radial frequency of the angular distortion.'
      },
      { name: 'twistSpeed', type: 'number', default: '1.2', description: 'Animation speed of the angular distortion.' },
      { name: 'lineFrequency', type: 'number', default: '5', description: 'Base frequency of the bright fibers.' },
      { name: 'lineSpacing', type: 'number', default: '2', description: 'Frequency increment applied per layer.' },
      { name: 'lineSharpness', type: 'number', default: '16', description: 'Sharpness of the thin fiber cores.' },
      { name: 'glowFalloff', type: 'number', default: '10', description: 'Falloff of the broad glowing bands.' },
      {
        name: 'glowIntensity',
        type: 'number',
        default: '1.6',
        description: 'Brightness multiplier for the broad glow.'
      },
      { name: 'brightness', type: 'number', default: '2', description: 'Exposure used by the final tone mapping.' },
      {
        name: 'blueBoost',
        type: 'number',
        default: '1.25',
        description: 'Multiplier applied to the final blue channel.'
      },
      { name: 'vignette', type: 'number', default: '0.8', description: 'Strength of the original edge darkening.' },
      {
        name: 'grain',
        type: 'number',
        default: '0.05',
        description: 'Strength of the layered screen-space film grain.'
      },
      { name: 'lightMode', type: 'boolean', default: 'false', description: 'Uses an ink-on-light compositing mode.' },
      { name: 'dpr', type: 'number', default: '1', description: 'Canvas pixel density, clamped between 0.5 and 2.' },
      { name: 'fps', type: 'number', default: '60', description: 'Maximum shader render rate.' },
      {
        name: 'paused',
        type: 'boolean',
        default: 'false',
        description: 'Freezes the animation and stops its render loop.'
      },
      {
        name: 'className',
        type: 'string',
        default: "''",
        description: 'Additional CSS classes applied to the container.'
      }
    ],
    []
  );

  return (
    <ComponentPropsProvider props={props} defaultProps={DEFAULT_PROPS} resetProps={resetProps} hasChanges={hasChanges}>
      <TabsLayout>
        <PreviewTab>
          <Box position="relative" className="demo-container" h={500} p={0} overflow="hidden">
            <GhostFibers key={key} {...props} />
            <BackgroundContent headline="Light woven from the quiet parts of the spectrum." />
          </Box>

          <Flex justify="flex-end" mt={2} mb={-2}>
            <OpenInStudioButton backgroundId="ghost-fibers" currentProps={props} defaultProps={DEFAULT_PROPS} />
          </Flex>

          <Customize forceRerender={forceRerender}>
            <PreviewColorPickerCustom
              title="Line Color"
              color={props.lineColor}
              onChange={value => updateProp('lineColor', value)}
            />
            <PreviewColorPickerCustom
              title="Glow Color"
              color={props.glowColor}
              onChange={value => updateProp('glowColor', value)}
            />
            <PreviewSlider
              title="Speed"
              min={0}
              max={2}
              step={0.01}
              value={props.speed}
              onChange={value => updateProp('speed', value)}
            />
            <PreviewSlider
              title="Scale"
              min={0.4}
              max={2}
              step={0.01}
              value={props.scale}
              onChange={value => updateProp('scale', value)}
            />
            <PreviewSlider
              title="Rotation"
              min={-180}
              max={180}
              step={1}
              value={props.rotation}
              valueUnit="deg"
              onChange={value => updateProp('rotation', value)}
            />
            <PreviewSlider
              title="Rotation Speed"
              min={-0.4}
              max={0.4}
              step={0.01}
              value={props.rotationSpeed}
              onChange={value => updateProp('rotationSpeed', value)}
            />
            <PreviewSlider
              title="Layers"
              min={1}
              max={10}
              step={1}
              value={props.layers}
              onChange={value => updateProp('layers', value)}
            />
            <PreviewSlider
              title="Wave Amplitude"
              min={0}
              max={0.3}
              step={0.005}
              value={props.waveAmplitude}
              onChange={value => updateProp('waveAmplitude', value)}
            />
            <PreviewSlider
              title="Wave Frequency"
              min={0.5}
              max={6}
              step={0.05}
              value={props.waveFrequency}
              onChange={value => updateProp('waveFrequency', value)}
            />
            <PreviewSlider
              title="Wave Speed"
              min={-2}
              max={2}
              step={0.05}
              value={props.waveSpeed}
              onChange={value => updateProp('waveSpeed', value)}
            />
            <PreviewSlider
              title="Layer Speed"
              min={-0.3}
              max={0.3}
              step={0.01}
              value={props.layerSpeed}
              onChange={value => updateProp('layerSpeed', value)}
            />
            <PreviewSlider
              title="Twist"
              min={0}
              max={0.5}
              step={0.005}
              value={props.twist}
              onChange={value => updateProp('twist', value)}
            />
            <PreviewSlider
              title="Twist Frequency"
              min={0.5}
              max={12}
              step={0.1}
              value={props.twistFrequency}
              onChange={value => updateProp('twistFrequency', value)}
            />
            <PreviewSlider
              title="Twist Speed"
              min={-3}
              max={3}
              step={0.05}
              value={props.twistSpeed}
              onChange={value => updateProp('twistSpeed', value)}
            />
            <PreviewSlider
              title="Line Frequency"
              min={1}
              max={10}
              step={0.1}
              value={props.lineFrequency}
              onChange={value => updateProp('lineFrequency', value)}
            />
            <PreviewSlider
              title="Line Spacing"
              min={0}
              max={4}
              step={0.05}
              value={props.lineSpacing}
              onChange={value => updateProp('lineSpacing', value)}
            />
            <PreviewSlider
              title="Line Sharpness"
              min={1}
              max={16}
              step={0.25}
              value={props.lineSharpness}
              onChange={value => updateProp('lineSharpness', value)}
            />
            <PreviewSlider
              title="Glow Falloff"
              min={1}
              max={16}
              step={0.25}
              value={props.glowFalloff}
              onChange={value => updateProp('glowFalloff', value)}
            />
            <PreviewSlider
              title="Glow Intensity"
              min={0}
              max={3}
              step={0.05}
              value={props.glowIntensity}
              onChange={value => updateProp('glowIntensity', value)}
            />
            <PreviewSlider
              title="Brightness"
              min={0.2}
              max={4}
              step={0.05}
              value={props.brightness}
              onChange={value => updateProp('brightness', value)}
            />
            <PreviewSlider
              title="Blue Boost"
              min={0.5}
              max={2}
              step={0.01}
              value={props.blueBoost}
              onChange={value => updateProp('blueBoost', value)}
            />
            <PreviewSlider
              title="Vignette"
              min={0}
              max={1}
              step={0.01}
              value={props.vignette}
              onChange={value => updateProp('vignette', value)}
            />
            <PreviewSlider
              title="Grain"
              min={0}
              max={0.12}
              step={0.0025}
              value={props.grain}
              onChange={value => updateProp('grain', value)}
            />
            <PreviewSwitch
              title="Light Rendering"
              isChecked={props.lightMode}
              onChange={value => updateProp('lightMode', value)}
            />
            <PreviewSelect
              title="Render Quality"
              options={[
                { value: 0.75, label: 'Performance' },
                { value: 1, label: 'Balanced' },
                { value: 1.25, label: 'Crisp' },
                { value: 1.5, label: 'Sharp' },
                { value: 2, label: 'Ultra' }
              ]}
              value={props.dpr}
              onChange={value => updateProp('dpr', value)}
            />
            <PreviewSelect
              title="Frame Rate"
              options={[
                { value: 24, label: '24 FPS' },
                { value: 30, label: '30 FPS' },
                { value: 45, label: '45 FPS' },
                { value: 60, label: '60 FPS' }
              ]}
              value={props.fps}
              onChange={value => updateProp('fps', value)}
            />
            <PreviewSwitch title="Paused" isChecked={props.paused} onChange={value => updateProp('paused', value)} />
          </Customize>

          <PropTable data={propData} />
          <Dependencies dependencyList={['ogl']} />
        </PreviewTab>

        <CodeTab>
          <CodeExample codeObject={ghostFibers} componentName="GhostFibers" />
        </CodeTab>
      </TabsLayout>
    </ComponentPropsProvider>
  );
};

export default GhostFibersDemo;
