use std::sync::{Arc, Mutex};
use tauri::{LogicalSize, Manager, PhysicalSize, WebviewWindow, WindowEvent};

// GTK 窗口未映射时还拿不到主题标题栏的实际尺寸，为系统装饰保留逻辑像素余量。
const DECORATION_MARGIN: f64 = 64.0;

fn available_inner_size(
    work_area: PhysicalSize<u32>,
    scale_factor: f64,
) -> Option<LogicalSize<f64>> {
    if work_area.width == 0
        || work_area.height == 0
        || !scale_factor.is_finite()
        || scale_factor <= 0.0
    {
        return None;
    }
    let area = work_area.to_logical::<f64>(scale_factor);
    Some(LogicalSize::new(
        (area.width - DECORATION_MARGIN).max(1.0),
        (area.height - DECORATION_MARGIN).max(1.0),
    ))
}

fn fit_size(size: LogicalSize<f64>, available: LogicalSize<f64>) -> LogicalSize<f64> {
    LogicalSize::new(
        size.width.min(available.width),
        size.height.min(available.height),
    )
}

fn update_minimum_size(
    window: &WebviewWindow,
    preferred: LogicalSize<f64>,
    applied: &Mutex<Option<LogicalSize<f64>>>,
) -> tauri::Result<Option<LogicalSize<f64>>> {
    let monitor = match window.current_monitor()? {
        Some(monitor) => Some(monitor),
        None => window.primary_monitor()?,
    };
    let Some(monitor) = monitor else {
        return Ok(None);
    };
    let Some(available) = available_inner_size(monitor.work_area().size, monitor.scale_factor())
    else {
        return Ok(None);
    };
    let minimum = fit_size(preferred, available);
    let mut applied = applied.lock().unwrap();
    // 调整约束可能产生 resize 事件，只在工作区或缩放确实改变时通知 GTK。
    if *applied != Some(minimum) {
        window.set_min_size(Some(minimum))?;
        *applied = Some(minimum);
    }
    Ok(Some(available))
}

pub fn initialize(window: &WebviewWindow) -> tauri::Result<()> {
    let config = window
        .app_handle()
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label());
    let preferred = LogicalSize::new(
        config.and_then(|config| config.min_width).unwrap_or(1.0),
        config.and_then(|config| config.min_height).unwrap_or(1.0),
    );
    let applied = Arc::new(Mutex::new(None));
    if let Some(available) = update_minimum_size(window, preferred, &applied)? {
        // 旧状态或默认尺寸也可能来自更大的屏幕；不主动改动最大化和全屏状态。
        if !window.is_maximized()? && !window.is_fullscreen()? {
            let size = window
                .inner_size()?
                .to_logical::<f64>(window.scale_factor()?);
            let fitted = fit_size(size, available);
            if fitted != size {
                window.set_size(fitted)?;
                window.center()?;
            }
        }
    }

    let target = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. }
                | WindowEvent::Focused(true)
        ) {
            if let Err(error) = update_minimum_size(&target, preferred, &applied) {
                eprintln!("更新 Linux 窗口尺寸约束失败: {error}");
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PREFERRED: LogicalSize<f64> = LogicalSize::new(1100.0, 680.0);

    #[test]
    fn minimum_fits_small_desktop_and_native_titlebar() {
        let available = available_inner_size(PhysicalSize::new(1024, 704), 1.0).unwrap();
        assert_eq!(
            fit_size(PREFERRED, available),
            LogicalSize::new(960.0, 640.0)
        );
        assert_eq!(
            fit_size(LogicalSize::new(1440.0, 900.0), available),
            available
        );
    }

    #[test]
    fn uses_logical_work_area_including_display_scaling_and_panels() {
        let available = available_inner_size(PhysicalSize::new(1920, 1000), 2.0).unwrap();
        assert_eq!(
            fit_size(PREFERRED, available),
            LogicalSize::new(896.0, 436.0)
        );
    }

    #[test]
    fn returning_to_large_monitor_restores_preferred_minimum() {
        let available = available_inner_size(PhysicalSize::new(1920, 1040), 1.0).unwrap();
        assert_eq!(fit_size(PREFERRED, available), PREFERRED);
        assert_eq!(
            fit_size(LogicalSize::new(1440.0, 900.0), available),
            LogicalSize::new(1440.0, 900.0)
        );
    }

    #[test]
    fn ignores_unavailable_monitor_geometry() {
        assert!(available_inner_size(PhysicalSize::new(0, 768), 1.0).is_none());
        assert!(available_inner_size(PhysicalSize::new(1024, 0), 1.0).is_none());
        for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(available_inner_size(PhysicalSize::new(1024, 768), scale).is_none());
        }
    }
}
